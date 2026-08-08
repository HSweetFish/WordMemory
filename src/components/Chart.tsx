import { useEffect, useRef } from 'react';
import echarts, { type EChartsCoreOption } from '@/lib/echarts';

interface ChartProps {
  option: EChartsCoreOption;
  height?: number;
  className?: string;
}

/** ECharts 轻量封装：自动初始化 / resize / 销毁 */
export default function Chart({ option, height = 300, className }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} className={className} style={{ height }} />;
}
