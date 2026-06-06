from app.schemas.tower_profile import TowerProfileUpsertRequest


def test_tower_profile_upsert_request_accepts_new_professional_fields() -> None:
    payload = TowerProfileUpsertRequest(
        structure_kind="直线杆塔",
        stroke_mode="反击",
        geometry_layers_json={
            "I": {
                "phase_spacing_m": {"upper": 5.1, "middle": 4.2, "lower": 3.3},
                "phase_height_m": {"upper": 25.0, "middle": 22.0, "lower": 19.0},
            }
        },
    )

    assert payload.structure_kind == "直线杆塔"
    assert payload.stroke_mode == "反击"
    assert payload.geometry_layers_json["I"]["phase_spacing_m"]["upper"] == 5.1