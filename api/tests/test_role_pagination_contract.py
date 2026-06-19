from __future__ import annotations

from app.services import legacy_admin_rbac_service as service


def _role_row(index: int) -> dict[str, object]:
    return {"id": f"role-{index}", "code": f"role-{index}", "name": f"Role {index}"}


def test_list_roles_returns_filtered_total_before_pagination(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(service, "_legacy_role_table_exists", lambda db: True)

    def load_page(db, *, role_source, keyword=None, limit=None, offset=0):
        captured.update({"role_source": role_source, "keyword": keyword, "limit": limit, "offset": offset})
        return [_role_row(3), _role_row(4)], 5

    monkeypatch.setattr(service, "_load_role_page", load_page)
    monkeypatch.setattr(service, "_load_role_menu_ids_map", lambda db, role_ids, *, role_source: {role_id: [] for role_id in role_ids})
    monkeypatch.setattr(service, "_load_menus_map", lambda db, menu_ids, *, role_source: {})
    monkeypatch.setattr(service, "_load_role_permission_codes_map", lambda db, role_ids, *, role_source: {role_id: [] for role_id in role_ids})

    response = service.list_roles(object(), keyword="role", limit=2, offset=2)

    assert response.total == 5
    assert [role.id for role in response.items] == ["role-3", "role-4"]
    assert captured == {"role_source": "legacy", "keyword": "role", "limit": 2, "offset": 2}


def test_list_roles_with_menus_paginates_roles_only(monkeypatch) -> None:
    captured: dict[str, object] = {}
    menu_response = service.MenuListResponse(items=[], total=2)

    monkeypatch.setattr(service, "_legacy_role_table_exists", lambda db: False)

    def load_page(db, *, role_source, keyword=None, limit=None, offset=0):
        captured.update({"role_source": role_source, "keyword": keyword, "limit": limit, "offset": offset})
        return [_role_row(2)], 3

    monkeypatch.setattr(service, "_load_role_page", load_page)
    monkeypatch.setattr(service, "_load_role_menu_ids_map", lambda db, role_ids, *, role_source: {role_id: [] for role_id in role_ids})
    monkeypatch.setattr(service, "_load_menus_map", lambda db, menu_ids, *, role_source: {})
    monkeypatch.setattr(service, "_load_role_permission_codes_map", lambda db, role_ids, *, role_source: {role_id: [] for role_id in role_ids})
    monkeypatch.setattr(service, "list_menus", lambda db: menu_response)

    response = service.list_roles_with_menus(object(), limit=1, offset=1)

    assert response.roles_total == 3
    assert [role.id for role in response.roles] == ["role-2"]
    assert response.menus == []
    assert response.menus_total == 2
    assert captured == {"role_source": "modern", "keyword": None, "limit": 1, "offset": 1}
