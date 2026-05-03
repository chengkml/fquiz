const TASK_NAME_LABELS: Record<string, string> = {
  "app.tasks.schedule_tasks.expire_overdue_schedule_items": "日程过期自动归档",
  "app.tasks.worker_registry_tasks.sweep_worker_registry_offline": "Worker 离线巡检",
  "app.tasks.elevation_tasks.apply_elevation_for_line_job": "线路高程回填",
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
