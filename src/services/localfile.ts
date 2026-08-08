import { db } from '@/db/schema';
import { exportAllData, restoreBackup, type BackupData } from '@/services/dataio';

/**
 * 本地文件夹同步（File System Access API，Chrome / Edge 85+）
 *
 * 把全部数据（词库 + 学习记录 + 统计 + 设置）自动备份到用户选择的硬盘文件夹，
 * 浏览器被清除站点数据后数据不丢：重新选回该文件夹即可一键恢复。
 *
 * 注意：仅 Chromium 系浏览器支持；句柄本身存在 IndexedDB（meta 表），
 * 清站点数据后句柄会丢失，但文件夹里的备份文件不受影响，重新选择即可。
 */

export const SYNC_FILE = 'wordmemory-data.json';
const HANDLE_KEY = 'localSyncFolder';
const NAME_KEY = 'localSyncName';
const AT_KEY = 'localSyncAt';

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

/** 带权限查询能力的目录句柄（queryPermission 在部分 TS DOM lib 中缺失，运行时 Chrome/Edge 均有） */
type PermissibleHandle = FileSystemDirectoryHandle & {
  queryPermission?: (opts?: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts?: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export function isLocalSyncSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

/** 从 meta 表读取已保存的文件夹句柄 */
export async function getStoredFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const row = await db.meta.get(HANDLE_KEY);
    return (row?.value as FileSystemDirectoryHandle) ?? null;
  } catch {
    return null;
  }
}

/** 句柄解析器（默认从 meta 读取；测试可替换为内存假句柄） */
let handleResolver: () => Promise<FileSystemDirectoryHandle | null> = getStoredFolderHandle;
export function setHandleResolverForTest(resolver: (() => Promise<FileSystemDirectoryHandle | null>) | null): void {
  handleResolver = resolver ?? getStoredFolderHandle;
}
async function resolveHandle(): Promise<FileSystemDirectoryHandle | null> {
  return handleResolver();
}

/** 弹出系统文件夹选择器并记住句柄（必须由用户手势触发） */
export async function pickDataFolder(): Promise<{ name: string } | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('当前浏览器不支持本地文件夹同步（需 Chrome / Edge 85+）');
  const handle = await picker({ mode: 'readwrite' });
  await db.meta.put({ key: HANDLE_KEY, value: handle });
  return { name: handle.name };
}

/** 断开本地同步（清除句柄，文件保留） */
export async function disconnectLocalSync(): Promise<void> {
  await db.meta.bulkDelete([HANDLE_KEY, NAME_KEY, AT_KEY]);
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as PermissibleHandle;
  const opts = { mode: 'readwrite' as const };
  try {
    if (!h.queryPermission || !h.requestPermission) return true; // 无权限 API 时视为已授权（测试环境）
    if ((await h.queryPermission(opts)) === 'granted') return true;
    return (await h.requestPermission(opts)) === 'granted';
  } catch {
    return false;
  }
}

/** 将完整备份写入同步文件（成功返回 true；未配置/权限不足返回 false） */
export async function syncToFolder(handle?: FileSystemDirectoryHandle): Promise<boolean> {
  const dir = handle ?? (await resolveHandle());
  if (!dir) return false;
  if (!(await ensurePermission(dir))) return false;
  const json = await exportAllData();
  const fileHandle = await dir.getFileHandle(SYNC_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(json);
  await writable.close();
  await db.meta.bulkPut([
    { key: NAME_KEY, value: dir.name },
    { key: AT_KEY, value: Date.now() },
  ]);
  return true;
}

/** 从同步文件读取备份（无文件/解析失败返回 null） */
export async function readBackupFromFolder(handle?: FileSystemDirectoryHandle): Promise<BackupData | null> {
  const dir = handle ?? (await resolveHandle());
  if (!dir) return null;
  if (!(await ensurePermission(dir))) return null;
  try {
    const fileHandle = await dir.getFileHandle(SYNC_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text) as BackupData;
    return data.app === 'wordmemory' ? data : null;
  } catch {
    return null;
  }
}

/** 从同步文件恢复全部数据（覆盖当前，返回恢复的备份） */
export async function restoreFromFolder(): Promise<BackupData> {
  const data = await readBackupFromFolder();
  if (!data) throw new Error('同步文件夹中没有找到有效的备份文件');
  return restoreBackup(JSON.stringify(data));
}

/** 本地同步状态（设置页展示用） */
export interface LocalSyncStatus {
  connected: boolean;
  folderName: string | null;
  lastSyncAt: number | null;
}

export async function getSyncStatus(): Promise<LocalSyncStatus> {
  const handle = await getStoredFolderHandle();
  if (!handle) return { connected: false, folderName: null, lastSyncAt: null };
  const [nameRow, atRow] = await Promise.all([db.meta.get(NAME_KEY), db.meta.get(AT_KEY)]);
  return {
    connected: true,
    folderName: (nameRow?.value as string) ?? null,
    lastSyncAt: (atRow?.value as number) ?? null,
  };
}

// ---- 自动同步（防抖，数据变化后延迟写盘） ----

/** 防抖间隔（可被测试缩短） */
export let SYNC_DEBOUNCE_MS = 3000;
export function setSyncDebounceMs(ms: number) {
  SYNC_DEBOUNCE_MS = ms;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

async function runSyncOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await syncToFolder();
  } catch {
    /* 静默：未配置 / 权限不足 / 写入失败时不影响主流程 */
  } finally {
    running = false;
  }
}

/** 立即落盘（清掉未执行的防抖计时） */
function flushNow(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  void runSyncOnce();
}

/** 数据变化后调用：防抖后自动写盘（未配置文件夹时静默跳过） */
export function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void runSyncOnce();
  }, SYNC_DEBOUNCE_MS);
}

/** 应用启动时调用：尝试静默同步一次 + 离开页面时立即落盘 */
export function initLocalSync(): void {
  if (!isLocalSyncSupported()) return;
  window.setTimeout(() => void runSyncOnce(), 2000);
  window.addEventListener('pagehide', () => flushNow());
}
