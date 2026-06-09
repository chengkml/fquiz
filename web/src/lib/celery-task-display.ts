const TASK_NAME_LABELS: Record<string, string> = {
  "app.tasks.atp_model_tasks.execute_atp_model_run_job": "ATP 模型仿真",
  "app.tasks.elevation_tasks.analyze_elevation_dataset_job": "高程数据集分析",
  "app.tasks.worker_registry_tasks.sweep_worker_registry_offline": "Worker 离线巡检",
  "app.tasks.elevation_tasks.apply_elevation_for_line_job": "线路高程回填",
  "app.tasks.wine_tasks.execute_wine_run_job": "Wine 运行任务",
};

export function getTaskDisplayName(taskName: string | null | undefined): string {
  const normalized = (taskName || "").trim();
  if (!normalized) {
    return "-";
  }
  const label = TASK_NAME_LABELS[normalized];
  if (!label) {
    return normalized;
  }
  return `${label} (${normalized})`;
}
