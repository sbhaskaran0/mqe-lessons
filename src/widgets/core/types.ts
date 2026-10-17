// Narrowed spec types for the runtime's widget components.
import type { WidgetSpec } from "../spec";

export type PanelsSpec = Extract<WidgetSpec, { type: "panels" }>;
export type ScatterFitSpec = Extract<WidgetSpec, { type: "scatter-fit" }>;
export type DataChartSpec = Extract<WidgetSpec, { type: "data-chart" }>;
export type DistributionSpec = Extract<WidgetSpec, { type: "distribution" }>;
export type ParamSpec = NonNullable<WidgetSpec["params"]>[string];
export type ReadoutSpec = NonNullable<WidgetSpec["readouts"]>[number];
