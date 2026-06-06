from app.services.fl_analysis_service import _grade_snapshot_payload


def test_grade_snapshot_payload_marks_high_risk_and_actions() -> None:
    payload = {
        "base_tower_json": {
            "tower_no": "T001",
            "tower_type": "耐张",
            "ground_resistance_ohm": 35.0,
            "lightning_density": 6.5,
            "span_large_m": 620.0,
        },
        "profile_json": {
            "structure_kind": "耐张",
            "stroke_mode": "反击",
            "arrester_a": "否",
            "arrester_b": "否",
            "arrester_c": "否",
        },
    }

    result = _grade_snapshot_payload(payload)

    assert result["risk_level"] == "high"
    assert result["score"] >= 80
    assert "接地电阻偏高" in result["cause_analysis"]
    assert "避雷器" in result["mitigation_recommendation"]


def test_grade_snapshot_payload_marks_low_risk_when_inputs_are_good() -> None:
    payload = {
        "base_tower_json": {
            "tower_no": "T002",
            "tower_type": "直线",
            "ground_resistance_ohm": 4.0,
            "lightning_density": 1.5,
            "span_large_m": 180.0,
        },
        "profile_json": {
            "structure_kind": "直线",
            "stroke_mode": "绕击",
            "arrester_a": "是",
            "arrester_b": "是",
            "arrester_c": "是",
        },
    }

    result = _grade_snapshot_payload(payload)

    assert result["risk_level"] == "low"
    assert result["score"] < 40
    assert result["cause_analysis"]
    assert result["mitigation_recommendation"]
