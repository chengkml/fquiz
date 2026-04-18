from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, get_current_user, require_any_permission, require_permission
from ...schemas.admin import (
    AuditLogListResponse,
    MenuCreateRequest,
    MenuListResponse,
    MenuPublic,
    MenuTreeItem,
    MenuUpdateRequest,
    RoleCreateRequest,
    RoleListResponse,
    RoleMenuUpdateRequest,
    RolePublic,
    RoleUpdateRequest,
)
from ...schemas.model_registry import (
    ModelApiKeyListResponse,
    ModelApiKeyPublic,
    ModelCreateRequest,
    ModelHealthCheckListResponse,
    ModelHealthCheckPublic,
    ModelListResponse,
    ModelRegistryPublic,
    ModelRotateKeyRequest,
    ModelRouteRuleCreateRequest,
    ModelRouteRuleListResponse,
    ModelRouteRulePublic,
    ModelRouteRuleUpdateRequest,
    ModelSummaryResponse,
    ModelTestChatRequest,
    ModelTestChatResponse,
    ModelTestRunListResponse,
    ModelTestRunPublic,
    ModelTestRunRequest,
    ModelTransitionRequest,
    ModelUpdateRequest,
    ModelUsageIngestRequest,
)
from ...services.admin_service import (
    build_menu_tree,
    create_menu,
    create_role,
    delete_menu,
    delete_role,
    get_menu_by_id,
    get_role_by_id,
    list_audit_logs,
    list_menus,
    list_permissions,
    list_role_menu_ids,
    list_roles,
    replace_role_menus,
    update_menu,
    update_role,
)
from ...services.model_service import (
    create_model,
    create_route_rule,
    delete_model,
    delete_route_rule,
    get_model_detail,
    get_model_summary,
    ingest_model_usage,
    list_model_health_checks,
    list_model_keys,
    list_model_tests,
    list_models,
    list_route_rules,
    rotate_model_key,
    run_model_health_check,
    run_model_test,
    run_model_test_chat,
    transition_model_status,
    update_model,
    update_route_rule,
)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/roles", response_model=RoleListResponse)
def get_roles(
    _: CurrentUser = Depends(require_any_permission("role.read", "role.manage")),
    db: Session = Depends(get_db),
) -> RoleListResponse:
    return list_roles(db)


@router.post("/roles", response_model=RolePublic)
def create_role_endpoint(
    payload: RoleCreateRequest,
    _: CurrentUser = Depends(require_permission("role.manage")),
    db: Session = Depends(get_db),
) -> RolePublic:
    created = create_role(db, payload)
    if not created:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role payload or duplicate role code")
    return created


@router.patch("/roles/{role_id}", response_model=RolePublic)
def update_role_endpoint(
    role_id: int,
    payload: RoleUpdateRequest,
    _: CurrentUser = Depends(require_permission("role.manage")),
    db: Session = Depends(get_db),
) -> RolePublic:
    updated = update_role(db, role_id, payload)
    if not updated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role not found or invalid update payload")
    return updated


@router.delete("/roles/{role_id}")
def delete_role_endpoint(
    role_id: int,
    _: CurrentUser = Depends(require_permission("role.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    deleted = delete_role(db, role_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role not found or protected role cannot be deleted")
    return {"success": True}


@router.get("/roles/{role_id}/menus")
def get_role_menus(
    role_id: int,
    _: CurrentUser = Depends(require_any_permission("role.read", "role.manage")),
    db: Session = Depends(get_db),
) -> dict[str, list[int]]:
    if not get_role_by_id(db, role_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    menu_ids = list_role_menu_ids(db, role_id)
    return {"menu_ids": menu_ids or []}


@router.put("/roles/{role_id}/menus", response_model=RolePublic)
def replace_role_menus_endpoint(
    role_id: int,
    payload: RoleMenuUpdateRequest,
    _: CurrentUser = Depends(require_permission("role.manage")),
    db: Session = Depends(get_db),
) -> RolePublic:
    updated = replace_role_menus(db, role_id, payload.menu_ids)
    if not updated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role not found or invalid menu ids")
    return updated


@router.get("/permissions")
def get_permissions(
    _: CurrentUser = Depends(require_any_permission("role.read", "role.manage")),
    db: Session = Depends(get_db),
) -> dict[str, list[dict[str, str | int]]]:
    return {"items": list_permissions(db)}


@router.get("/audit-logs", response_model=AuditLogListResponse)
def get_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    _: CurrentUser = Depends(require_any_permission("menu.read", "menu.manage")),
    db: Session = Depends(get_db),
) -> AuditLogListResponse:
    return list_audit_logs(
        db,
        limit=limit,
        offset=offset,
        action=action,
        user_id=user_id,
    )


@router.get("/models/summary", response_model=ModelSummaryResponse)
def get_models_summary(
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelSummaryResponse:
    return get_model_summary(db)


@router.get("/models", response_model=ModelListResponse)
def get_models(
    status_filter: str | None = Query(default=None, alias="status"),
    keyword: str | None = Query(default=None),
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelListResponse:
    return list_models(db, status_filter=status_filter, keyword=keyword)


@router.get("/password/models", response_model=ModelListResponse)
def get_password_models(
    status_filter: str | None = Query(default=None, alias="status"),
    keyword: str | None = Query(default=None),
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelListResponse:
    """密钥管理菜单专用：模型列表（复用模型服务）。"""
    return list_models(db, status_filter=status_filter, keyword=keyword)


@router.get("/password/models/{model_id}/keys", response_model=ModelApiKeyListResponse)
def get_password_model_keys(
    model_id: int,
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelApiKeyListResponse:
    """密钥管理菜单专用：模型密钥列表。"""
    return list_model_keys(db, model_id)


@router.post("/password/models/{model_id}/rotate-key", response_model=ModelApiKeyPublic)
def rotate_password_model_key_endpoint(
    model_id: int,
    payload: ModelRotateKeyRequest,
    current_user: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelApiKeyPublic:
    """密钥管理菜单专用：轮换模型密钥。"""
    return rotate_model_key(db, model_id, payload, actor=current_user.user)


@router.get("/models/{model_id}", response_model=ModelRegistryPublic)
def get_model(
    model_id: int,
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelRegistryPublic:
    return get_model_detail(db, model_id)


@router.post("/models", response_model=ModelRegistryPublic)
def create_model_endpoint(
    payload: ModelCreateRequest,
    current_user: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelRegistryPublic:
    return create_model(db, payload, actor=current_user.user)


@router.patch("/models/{model_id}", response_model=ModelRegistryPublic)
def update_model_endpoint(
    model_id: int,
    payload: ModelUpdateRequest,
    _: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelRegistryPublic:
    return update_model(db, model_id, payload)


@router.post("/models/{model_id}/transition", response_model=ModelRegistryPublic)
def transition_model_endpoint(
    model_id: int,
    payload: ModelTransitionRequest,
    current_user: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelRegistryPublic:
    return transition_model_status(db, model_id, payload, actor=current_user.user)


@router.delete("/models/{model_id}")
def delete_model_endpoint(
    model_id: int,
    _: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    delete_model(db, model_id)
    return {"success": True}


@router.get("/models/{model_id}/keys", response_model=ModelApiKeyListResponse)
def get_model_keys(
    model_id: int,
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelApiKeyListResponse:
    return list_model_keys(db, model_id)


@router.post("/models/{model_id}/rotate-key", response_model=ModelApiKeyPublic)
def rotate_model_key_endpoint(
    model_id: int,
    payload: ModelRotateKeyRequest,
    current_user: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelApiKeyPublic:
    return rotate_model_key(db, model_id, payload, actor=current_user.user)


@router.post("/models/{model_id}/health-check", response_model=ModelHealthCheckPublic)
def run_model_health_check_endpoint(
    model_id: int,
    _: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelHealthCheckPublic:
    return run_model_health_check(db, model_id)


@router.get("/models/{model_id}/health-checks", response_model=ModelHealthCheckListResponse)
def get_model_health_checks(
    model_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelHealthCheckListResponse:
    return list_model_health_checks(db, model_id, limit=limit)


@router.post("/models/{model_id}/tests", response_model=ModelTestRunPublic)
def run_model_test_endpoint(
    model_id: int,
    payload: ModelTestRunRequest,
    current_user: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelTestRunPublic:
    return run_model_test(db, model_id, payload, actor=current_user.user)


@router.post("/models/{model_id}/test-chat", response_model=ModelTestChatResponse)
def run_model_test_chat_endpoint(
    model_id: int,
    payload: ModelTestChatRequest,
    current_user: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelTestChatResponse:
    return run_model_test_chat(db, model_id, payload, actor=current_user.user)


@router.get("/models/{model_id}/tests", response_model=ModelTestRunListResponse)
def get_model_tests(
    model_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelTestRunListResponse:
    return list_model_tests(db, model_id, limit=limit)


@router.post("/models/usage")
def ingest_model_usage_endpoint(
    payload: ModelUsageIngestRequest,
    _: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    return ingest_model_usage(db, payload)


@router.get("/model-routes", response_model=ModelRouteRuleListResponse)
def get_model_routes(
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> ModelRouteRuleListResponse:
    return list_route_rules(db)


@router.post("/model-routes", response_model=ModelRouteRulePublic)
def create_model_route_endpoint(
    payload: ModelRouteRuleCreateRequest,
    _: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelRouteRulePublic:
    return create_route_rule(db, payload)


@router.patch("/model-routes/{route_rule_id}", response_model=ModelRouteRulePublic)
def update_model_route_endpoint(
    route_rule_id: int,
    payload: ModelRouteRuleUpdateRequest,
    _: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> ModelRouteRulePublic:
    return update_route_rule(db, route_rule_id, payload)


@router.delete("/model-routes/{route_rule_id}")
def delete_model_route_endpoint(
    route_rule_id: int,
    _: CurrentUser = Depends(require_permission("model.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    return delete_route_rule(db, route_rule_id)


@router.get("/menus", response_model=MenuListResponse)
def get_menus(
    _: CurrentUser = Depends(require_any_permission("menu.read", "menu.manage")),
    db: Session = Depends(get_db),
) -> MenuListResponse:
    return list_menus(db)


@router.post("/menus", response_model=MenuPublic)
def create_menu_endpoint(
    payload: MenuCreateRequest,
    _: CurrentUser = Depends(require_permission("menu.manage")),
    db: Session = Depends(get_db),
) -> MenuPublic:
    created = create_menu(db, payload)
    if not created:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid menu payload or duplicate menu code")
    return created


@router.patch("/menus/{menu_id}", response_model=MenuPublic)
def update_menu_endpoint(
    menu_id: int,
    payload: MenuUpdateRequest,
    _: CurrentUser = Depends(require_permission("menu.manage")),
    db: Session = Depends(get_db),
) -> MenuPublic:
    if not get_menu_by_id(db, menu_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu not found")
    updated = update_menu(db, menu_id, payload)
    if not updated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid menu update payload")
    return updated


@router.delete("/menus/{menu_id}")
def delete_menu_endpoint(
    menu_id: int,
    _: CurrentUser = Depends(require_permission("menu.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    deleted = delete_menu(db, menu_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Menu not found or protected menu cannot be deleted")
    return {"success": True}


@router.get("/menus/tree", response_model=list[MenuTreeItem])
def get_menu_tree(
    _: CurrentUser = Depends(require_any_permission("menu.read", "menu.manage")),
    db: Session = Depends(get_db),
) -> list[MenuTreeItem]:
    return build_menu_tree(db)


@router.get("/me/menus", response_model=list[MenuTreeItem])
def get_current_user_menus(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MenuTreeItem]:
    return build_menu_tree(db, role_codes=current_user.role_codes)
