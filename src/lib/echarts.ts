/**
 * ECharts 按需引入配置
 * 只注册仪表盘用到的图表与组件，显著减小打包体积。
 */
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, HeatmapChart } from 'echarts/charts';
import {
  CalendarComponent,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  CalendarComponent,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export default echarts;
export type { EChartsCoreOption } from 'echarts/core';
