from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission
from ...schemas.task_monitor import TaskMonitorOverviewResponse
from ...services.task_monitor_service import build_task_monitor_overview

router = APIRouter(prefix="/admin/task-monitor", tags=["admin-task-monitor"])


@router.get("/overview", response_model=TaskMonitorOverviewResponse)
def get_task_monitor_overview(
    risk_limit: int = Query(default=20, ge=1, le=200),
    stale_hours: int = Query(default=48, ge=1, le=24 * 30),
    current_user: CurrentUser = Depends(
        require_any_permission(
            "requirement.read",
            "requirement.process",
            "requirement.manage",
            "todo.read",
            "todo.process",
            "todo.manage",
        )
    ),
    db: Session = Depends(get_db),
) -> TaskMonitorOverviewResponse:
    is_admin = "admin" in current_user.role_codes
    permission_codes = current_user.permission_codes

    can_read_requirements = is_admin or bool(
        {"requirement.read", "requirement.process", "requirement.manage"} & permission_codes
    )
    can_read_todos = is_admin or bool(
        {"todo.read", "todo.process", "todo.manage"} & permission_codes
    )
    can_manage_todos = is_admin or "todo.manage" in permission_codes

    return build_task_monitor_overview(
        db,
        actor=current_user.user,
        can_read_requirements=can_read_requirements,
        can_read_todos=can_read_todos,
        can_manage_todos=can_manage_todos,
        risk_limit=risk_limit,
        stale_hours=stale_hours,
    )
