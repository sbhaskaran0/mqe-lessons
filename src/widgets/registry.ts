// Widget type -> component, loaded on demand so a lesson only downloads the widget kinds it uses.
// `custom` is still a stand-in until its runtime lands.
import { lazy, type LazyExoticComponent } from "react";
import type { WidgetComponent } from "./host";
import type { WidgetType } from "./spec";

const comingSoon = () => import("./ComingSoon");

const loaders: Record<WidgetType, () => Promise<{ default: WidgetComponent }>> = {
  panels: () => import("./panels/Panels"),
  "scatter-fit": () => import("./scatter-fit/ScatterFit"),
  "data-chart": () => import("./data-chart/DataChart"),
  distribution: () => import("./distribution/Distribution"),
  custom: comingSoon,
};

export const registry = Object.fromEntries(Object.entries(loaders).map(([type, load]) => [type, lazy(load)])) as Record<
  WidgetType,
  LazyExoticComponent<WidgetComponent>
>;

/** Starts downloading the components for these widget types; the module cache hands them to `lazy` later. */
export function preload(types: Iterable<WidgetType>) {
  for (const type of new Set(types)) void loaders[type]().catch(() => {}); // a failure surfaces when the widget mounts
}

/** Whether a widget type has a real runtime (`custom` is still a stand-in), so "mounted live" means a learner saw it. */
export const hasRuntime = (type: WidgetType) => loaders[type] !== comingSoon;
