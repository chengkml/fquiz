from __future__ import annotations

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("MINIO_ENABLED", "false")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.app import models  # noqa: F401
from api.app.api.v1.admin import router as admin_router
from api.app.core.database import Base, get_db, init_db
from api.app.core.dependencies import CurrentUser, get_current_user
from api.app.models.menu import Menu
from api.app.models.user import User
from api.app.services.seed_service import DEFAULT_MENUS, SeedDefaultsResult, seed_defaults


DEFAULT_MENU_BY_CODE = {
    str(menu["code"]): menu
    for menu in DEFAULT_MENUS
}


class DatabaseFixtureTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.SessionLocal = sessionmaker(
            bind=self.engine,
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
        )
        Base.metadata.create_all(bind=self.engine)

    def tearDown(self) -> None:
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()


class InitDbContractTest(unittest.TestCase):
    def test_init_db_does_not_open_a_seed_session(self) -> None:
        with patch("api.app.core.database._ensure_user_pk_column_compatibility"), patch(
            "api.app.core.database._ensure_user_timestamp_column_compatibility"
        ), patch("api.app.core.database._ensure_user_audit_column_compatibility"), patch(
            "api.app.core.database._ensure_elevation_dataset_column_compatibility"
        ), patch("api.app.core.database._ensure_tower_model_column_compatibility"), patch(
            "api.app.core.database._ensure_tower_profile_column_compatibility"
        ), patch("api.app.core.database.Base.metadata.create_all") as create_all, patch(
            "api.app.core.database.SessionLocal"
        ) as session_local:
            init_db()

        create_all.assert_called_once()
        session_local.assert_not_called()


class SeedDefaultsServiceTest(DatabaseFixtureTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.session = self.SessionLocal()

    def tearDown(self) -> None:
        self.session.close()
        super().tearDown()

    def _run_seed(self, *, force: bool = False) -> SeedDefaultsResult:
        with patch(
            "api.app.services.seed_service._seed_legacy_tower_models_if_empty",
            return_value=None,
        ):
            return seed_defaults(self.session, force=force)

    def _load_menu(self, code: str) -> Menu:
        menu = self.session.scalar(select(Menu).where(Menu.code == code))
        self.assertIsNotNone(menu)
        return menu

    def test_seed_defaults_preserves_existing_menu_changes_by_default(self) -> None:
        self._run_seed()

        menu = self._load_menu("admin.menus")
        menu.name = "自定义菜单"
        menu.sort_order = 999
        self.session.commit()

        result = self._run_seed()
        self.session.expire_all()

        refreshed = self._load_menu("admin.menus")
        self.assertEqual(refreshed.name, "自定义菜单")
        self.assertEqual(refreshed.sort_order, 999)
        self.assertEqual(result.mode, "missing_only")
        self.assertFalse(result.overwrote_existing)

    def test_seed_defaults_force_restores_default_menu_fields(self) -> None:
        self._run_seed()

        menu = self._load_menu("admin.menus")
        menu.name = "自定义菜单"
        menu.sort_order = 999
        self.session.commit()

        result = self._run_seed(force=True)
        self.session.expire_all()

        refreshed = self._load_menu("admin.menus")
        default_menu = DEFAULT_MENU_BY_CODE["admin.menus"]
        self.assertEqual(refreshed.name, str(default_menu["name"]))
        self.assertEqual(refreshed.sort_order, int(default_menu["sort_order"]))
        self.assertEqual(result.mode, "force_overwrite")
        self.assertTrue(result.overwrote_existing)
        self.assertGreater(result.summary["menus"].overwritten, 0)


class SeedDefaultsEndpointTest(DatabaseFixtureTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.app = FastAPI()
        self.app.include_router(admin_router, prefix="/api/v1")

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        current_user = CurrentUser(
            user=User(
                id="admin",
                email="admin@example.com",
                username="admin",
                password_hash="secret",
                status="ENABLED",
            ),
            role_codes={"admin"},
            permission_codes={"menu.manage"},
        )
        self.app.dependency_overrides[get_db] = override_get_db
        self.app.dependency_overrides[get_current_user] = lambda: current_user
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.app.dependency_overrides.clear()
        super().tearDown()

    def test_seed_defaults_endpoint_triggers_seed_service(self) -> None:
        result = SeedDefaultsResult(force=True)
        result.summary["menus"].updated = 1
        result.summary["menus"].overwritten = 1

        with patch("api.app.api.v1.admin.seed_defaults", return_value=result) as seed_defaults_mock:
            response = self.client.post("/api/v1/admin/system/seed-defaults?force=true")

        self.assertEqual(response.status_code, 200)
        seed_defaults_mock.assert_called_once()
        self.assertTrue(seed_defaults_mock.call_args.kwargs["force"])

        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["mode"], "force_overwrite")
        self.assertTrue(payload["overwrote_existing"])
        self.assertEqual(payload["summary"]["menus"]["updated"], 1)
        self.assertEqual(payload["summary"]["menus"]["overwritten"], 1)


if __name__ == "__main__":
    unittest.main()
