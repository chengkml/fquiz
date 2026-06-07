from __future__ import annotations

import math
from typing import Any, Mapping


_AC_STANDARD_BY_VOLTAGE: dict[int, tuple[float, dict[int, float]]] = {
    35: (450.0, {1: 16.0, 2: 23.0, 4: 40.0}),
    66: (850.0, {1: 18.0, 2: 25.0, 4: 42.0}),
    110: (1314.0, {1: 20.0, 2: 28.0, 4: 44.0}),
    220: (2265.0, {1: 33.0, 2: 45.0, 4: 50.0}),
    330: (3155.0, {1: 35.0, 2: 46.0, 4: 52.0}),
    500: (4575.0, {1: 39.0, 2: 67.0, 4: 80.0}),
    750: (6745.0, {1: 55.0, 2: 124.0, 4: 130.0}),
}
_DEFAULT_AC_STANDARD = (9000.0, {1: 60.0, 2: 130.0, 4: 140.0})
_DC_STANDARD_BY_VOLTAGE: dict[int, tuple[float, float]] = {
    500: (6000.0, 50.0),
    800: (8500.0, 77.0),
}
_DEFAULT_DC_STANDARD = (9000.0, 90.0)
_ARRESTER_NEGATIVE_VALUES = {"否", "无", "未装", "0", "false", "False", "FALSE"}


def grade_snapshot_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    base = dict(payload.get("base_tower_json") or {})
    profile = dict(payload.get("profile_json") or {})
    reason_details = _build_reason_details(base, profile)
    detail_map = {item["code"]: item for item in reason_details}

    score = 0
    causes: list[str] = []
    recommendations: list[str] = []

    ground_resistance = _as_float(base.get("ground_resistance_ohm"))
    lightning_density = _as_float(base.get("lightning_density"))
    span_large = _as_float(base.get("span_large_m"))
    tower_type = str(base.get("tower_type") or profile.get("structure_kind") or "")
    stroke_mode = str(profile.get("stroke_mode") or "")
    arrester_values = [profile.get("arrester_a"), profile.get("arrester_b"), profile.get("arrester_c")]

    if ground_resistance is not None:
        if ground_resistance >= 30:
            score += 35
            causes.append("接地电阻偏高")
            recommendations.append("优先降低接地电阻，复核接地网与冲击接地通道")
        elif ground_resistance >= 15:
            score += 18
            causes.append("接地电阻偏高趋势明显")

    if lightning_density is not None:
        if lightning_density >= 6:
            score += 25
            causes.append("地闪密度较高")
            recommendations.append("按高雷区口径校核绝缘与屏蔽配置")
        elif lightning_density >= 3:
            score += 12
            causes.append("地闪密度中等偏高")

    if span_large is not None:
        if span_large >= 500:
            score += 20
            causes.append("大号侧档距过大")
            recommendations.append("复核大跨距杆塔绝缘配合与防雷保护")
        elif span_large >= 300:
            score += 10
            causes.append("档距偏大")

    insulator_detail = detail_map.get("insulator_length")
    if insulator_detail:
        insulator_grade = _as_int(insulator_detail.get("grade"))
        if insulator_grade is not None and insulator_grade <= 2:
            score += 20
            causes.append("绝缘子串长度偏短")
            recommendations.append("提高绝缘子串长度并校核绝缘配置")
        elif insulator_grade == 3:
            score += 8
            causes.append("绝缘配置裕度一般")

    slope_detail = detail_map.get("terrain_slope")
    if slope_detail:
        slope_grade = _as_int(slope_detail.get("grade"))
        if slope_grade is not None and slope_grade <= 2:
            score += 12
            causes.append("地面倾角较大")
            recommendations.append("关注地形暴露影响并加强接地与巡检")
        elif slope_grade == 3:
            score += 5
            causes.append("地面倾角偏大")

    protection_detail = detail_map.get("protection_angle")
    if protection_detail:
        protection_grade = _as_int(protection_detail.get("grade"))
        if protection_grade is not None and protection_grade <= 2:
            score += 18
            causes.append("保护角暴露偏大")
            recommendations.append("优化避雷线与保护角配置")
        elif protection_grade == 3:
            score += 8
            causes.append("保护角裕度一般")

    shield_wire_detail = detail_map.get("shield_wire_height")
    shield_wire_grade = _as_int(shield_wire_detail.get("grade")) if shield_wire_detail else None
    if shield_wire_grade is not None and shield_wire_grade <= 2:
        score += 10
        causes.append("杆塔高度暴露偏高")
        recommendations.append("复核塔型高度与屏蔽布置")

    if "耐张" in tower_type:
        score += 10
        causes.append("耐张杆塔参数更敏感")

    if "反击" in stroke_mode:
        score += 10
        causes.append("当前以反击风险为主")
        recommendations.append("优先关注反击耐雷水平与接地改造")

    if any(str(value or "").strip() in _ARRESTER_NEGATIVE_VALUES for value in arrester_values):
        score += 15
        causes.append("避雷器配置不足")
        recommendations.append("补充关键相避雷器并复核安装位置")

    score = min(score, 100)
    if score >= 80:
        risk_level = "high"
    elif score >= 45:
        risk_level = "medium"
    else:
        risk_level = "low"

    if not causes:
        causes.append("主要输入参数处于低风险区间")
    if not recommendations:
        recommendations.append("维持现有防雷配置并保持常规巡检")

    cause_analysis = "；".join(dict.fromkeys(causes))
    mitigation_recommendation = "；".join(dict.fromkeys(recommendations))
    tower_no = str(base.get("tower_no") or "")
    summary_text = f"{tower_no or '当前杆塔'}评估为{risk_level}风险，综合得分{score}"

    return {
        "risk_level": risk_level,
        "score": score,
        "cause_analysis": cause_analysis,
        "mitigation_recommendation": mitigation_recommendation,
        "summary_text": summary_text,
        "reason_details": reason_details,
        "inputs": {
            "ground_resistance_ohm": ground_resistance,
            "lightning_density": lightning_density,
            "span_large_m": span_large,
            "tower_type": tower_type,
            "stroke_mode": stroke_mode,
            "insulator_length_mm": _normalize_insulator_length_mm(
                _as_float(profile.get("insulator_length_m"))
                or _as_float(((profile.get("geometry_layers_json") or {}).get("insulator_length_mm")))
                or _as_float(((base.get("circuit_geometry_json") or {}).get("insulator_length_mm")))
            ),
            "terrain_slope_deg": _max_abs_float(base.get("slope_1"), base.get("slope_2")),
            "protection_angle_deg": _compute_protection_angle_deg(base, profile),
        },
    }


def grade_mitigation_snapshot_payload(payload: Mapping[str, Any], *, non_construction: bool = False) -> dict[str, Any]:
    base = dict(payload.get("base_tower_json") or {})
    profile = dict(payload.get("profile_json") or {})
    source_result = _coerce_risk_result_snapshot(payload.get("source_result_json"))
    current = source_result or grade_snapshot_payload(payload)
    current_score = int(current["score"])
    current_risk_level = str(current["risk_level"])
    actions = _build_mitigation_actions(
        base=base,
        profile=profile,
        current=current,
        non_construction=non_construction,
    )

    simulated_base = dict(base)
    simulated_profile = dict(profile)
    _apply_mitigation_actions(base=simulated_base, profile=simulated_profile, actions=actions)
    expected = grade_snapshot_payload(
        {
            "base_tower_json": simulated_base,
            "profile_json": simulated_profile,
        }
    )

    if current_risk_level == "low" and not actions:
        recommendation_result = "达标低风险"
    elif any(action["code"] == "arrester_install" for action in actions):
        recommendation_result = "需要安装避雷器"
    else:
        recommendation_result = "不需要安装避雷器"

    tower_no = str(base.get("tower_no") or "")
    recommendation_text = "；".join(action["summary"] for action in actions) if actions else "维持现有配置并保持常规巡检"
    summary_text = (
        f"{tower_no or '当前杆塔'}当前{current_risk_level}风险，"
        f"建议后预期降为{expected['risk_level']}风险，当前/预期得分 {current_score}/{expected['score']}"
    )

    return {
        "risk_level": expected["risk_level"],
        "score": expected["score"],
        "current_risk_level": current_risk_level,
        "current_score": current_score,
        "expected_risk_level": expected["risk_level"],
        "expected_score": expected["score"],
        "cause_analysis": current["cause_analysis"],
        "mitigation_recommendation": recommendation_text,
        "summary_text": summary_text,
        "reason_details": current["reason_details"],
        "mitigation_actions": actions,
        "recommendation_result": recommendation_result,
        "non_construction": non_construction,
        "inputs": current["inputs"],
    }


def _coerce_risk_result_snapshot(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    snapshot = dict(value)
    if "risk_level" not in snapshot or "score" not in snapshot:
        return None
    if "cause_analysis" not in snapshot or "reason_details" not in snapshot or "inputs" not in snapshot:
        return None
    return snapshot


def _build_reason_details(base: Mapping[str, Any], profile: Mapping[str, Any]) -> list[dict[str, Any]]:
    voltage_kv = _infer_voltage_kv(base, profile)
    structure_count = _infer_structure_count(base, profile)
    insulator_standard_mm, height_standard_m = _standard_values_for_line(base, profile, voltage_kv, structure_count)

    insulator_length_mm = _normalize_insulator_length_mm(
        _as_float(profile.get("insulator_length_m"))
        or _as_float((profile.get("geometry_layers_json") or {}).get("insulator_length_mm"))
        or _as_float((base.get("circuit_geometry_json") or {}).get("insulator_length_mm"))
    )
    ground_resistance = _as_float(base.get("ground_resistance_ohm"))
    shield_wire_height = _as_float(profile.get("shield_wire_height_m")) or _as_float(
        ((base.get("circuit_geometry_json") or {}).get("lightning_wire") or {}).get("height_m")
    )
    slope_value = _max_abs_float(base.get("slope_1"), base.get("slope_2"))
    protection_angle_deg = _compute_protection_angle_deg(base, profile)

    result = [
        {
            "code": "insulator_length",
            "label": "绝缘子串长度档次",
            "value": insulator_length_mm,
            "standard_value": insulator_standard_mm,
            "grade": _grade_insulator_length(insulator_length_mm, insulator_standard_mm),
            "triggered": False,
        },
        {
            "code": "ground_resistance",
            "label": "接地电阻档次",
            "value": ground_resistance,
            "grade": _grade_ground_resistance(ground_resistance),
            "triggered": False,
        },
        {
            "code": "shield_wire_height",
            "label": "高度档次",
            "value": shield_wire_height,
            "standard_value": height_standard_m,
            "grade": _grade_height_exposure(shield_wire_height, height_standard_m),
            "triggered": False,
        },
        {
            "code": "terrain_slope",
            "label": "地面倾角档次",
            "value": slope_value,
            "grade": _grade_terrain_slope(slope_value),
            "triggered": False,
        },
        {
            "code": "protection_angle",
            "label": "保护角档次",
            "value": protection_angle_deg,
            "grade": _grade_protection_angle(protection_angle_deg),
            "triggered": False,
        },
    ]
    for item in result:
        item["triggered"] = item["grade"] is not None and int(item["grade"]) <= 2
    return result


def _build_mitigation_actions(
    *,
    base: Mapping[str, Any],
    profile: Mapping[str, Any],
    current: Mapping[str, Any],
    non_construction: bool,
) -> list[dict[str, Any]]:
    detail_map = {item["code"]: item for item in current.get("reason_details", []) if isinstance(item, Mapping)}
    actions: list[dict[str, Any]] = []
    voltage_kv = _infer_voltage_kv(base, profile)
    structure_count = _infer_structure_count(base, profile)
    insulator_standard_mm, _ = _standard_values_for_line(base, profile, voltage_kv, structure_count)
    current_score = int(current.get("score") or 0)

    insulator_detail = detail_map.get("insulator_length")
    if insulator_detail and _as_int(insulator_detail.get("grade")) and _as_int(insulator_detail.get("grade")) <= 3:
        factor = 1.3 if current_score >= 80 else 1.2 if current_score >= 45 else 1.1
        target_mm = round(insulator_standard_mm * factor, 2)
        current_value = _normalize_insulator_length_mm(_as_float(insulator_detail.get("value")))
        if current_value is not None and current_value < target_mm:
            actions.append(
                {
                    "code": "insulator_upgrade",
                    "label": "提高绝缘子串长度",
                    "summary": f"将绝缘子串长度提高至约 {target_mm} mm",
                    "current_value": current_value,
                    "target_value": target_mm,
                    "unit": "mm",
                }
            )

    ground_detail = detail_map.get("ground_resistance")
    ground_value = _as_float(base.get("ground_resistance_ohm"))
    if ground_detail and _as_int(ground_detail.get("grade")) and _as_int(ground_detail.get("grade")) <= 4 and ground_value is not None:
        if ground_value > 20:
            target_ground = 3.0
        elif ground_value > 15:
            target_ground = 5.0
        elif ground_value > 10:
            target_ground = 10.0
        else:
            target_ground = 5.0
        if ground_value > target_ground:
            actions.append(
                {
                    "code": "grounding_upgrade",
                    "label": "降低接地电阻",
                    "summary": f"将接地电阻优化至 {target_ground} Ω 以内",
                    "current_value": ground_value,
                    "target_value": target_ground,
                    "unit": "ohm",
                }
            )

    missing_arrester_phases = _missing_arrester_phases(profile)
    if missing_arrester_phases or current_score >= 80:
        phases = missing_arrester_phases or ["A", "B", "C"]
        actions.append(
            {
                "code": "arrester_install",
                "label": "补装避雷器",
                "summary": f"建议在 {','.join(phases)} 相补装或复核避雷器",
                "phases": phases,
            }
        )

    protection_detail = detail_map.get("protection_angle")
    if non_construction and protection_detail and _as_int(protection_detail.get("grade")) and _as_int(protection_detail.get("grade")) <= 3:
        target_angle = _target_protection_angle_deg(base, profile)
        actions.append(
            {
                "code": "shielding_geometry",
                "label": "优化保护角",
                "summary": f"按非建线口径将保护角收紧至约 {target_angle}°",
                "target_value": target_angle,
                "unit": "deg",
            }
        )

    slope_detail = detail_map.get("terrain_slope")
    if slope_detail and _as_int(slope_detail.get("grade")) and _as_int(slope_detail.get("grade")) <= 2:
        actions.append(
            {
                "code": "terrain_grounding_review",
                "label": "复核地形暴露与接地",
                "summary": "重点复核边坡暴露、接地引下线和冲击通道布置",
            }
        )

    span_large = _as_float(base.get("span_large_m"))
    if span_large is not None and span_large >= 500:
        actions.append(
            {
                "code": "long_span_review",
                "label": "复核大跨距绝缘配合",
                "summary": "大跨距杆塔建议同步复核绝缘配合与屏蔽校核",
            }
        )

    return actions


def _apply_mitigation_actions(*, base: dict[str, Any], profile: dict[str, Any], actions: list[dict[str, Any]]) -> None:
    geometry_layers = dict(profile.get("geometry_layers_json") or {})
    lightning_wire = dict((base.get("circuit_geometry_json") or {}).get("lightning_wire") or {})
    for action in actions:
        code = action.get("code")
        if code == "insulator_upgrade":
            target_mm = _as_float(action.get("target_value"))
            if target_mm is None:
                continue
            current_profile_value = _as_float(profile.get("insulator_length_m"))
            if current_profile_value is not None and current_profile_value <= 20:
                profile["insulator_length_m"] = round(target_mm / 1000.0, 4)
            else:
                profile["insulator_length_m"] = target_mm
            geometry_layers["insulator_length_mm"] = target_mm
        elif code == "grounding_upgrade":
            target_ground = _as_float(action.get("target_value"))
            if target_ground is not None:
                base["ground_resistance_ohm"] = target_ground
        elif code == "arrester_install":
            phases = action.get("phases") or []
            for phase in phases:
                profile[f"arrester_{str(phase).lower()}"] = "是"
        elif code == "shielding_geometry":
            target_angle = _as_float(action.get("target_value"))
            if target_angle is None:
                continue
            top_phase_height = _max_phase_height(base, profile)
            if top_phase_height is None:
                continue
            height_value = _as_float(profile.get("shield_wire_height_m")) or _as_float(lightning_wire.get("height_m")) or top_phase_height + 8.0
            horizontal = math.tan(math.radians(abs(target_angle))) * max(height_value - top_phase_height, 1.0)
            lightning_wire["left_mid_distance_m"] = round(horizontal, 3)
            lightning_wire["right_mid_distance_m"] = round(horizontal, 3)
            if not profile.get("shield_wire_height_m"):
                profile["shield_wire_height_m"] = height_value
    if lightning_wire:
        base_geometry = dict(base.get("circuit_geometry_json") or {})
        base_geometry["lightning_wire"] = lightning_wire
        base["circuit_geometry_json"] = base_geometry
    if geometry_layers:
        profile["geometry_layers_json"] = geometry_layers


def _standard_values_for_line(
    base: Mapping[str, Any],
    profile: Mapping[str, Any],
    voltage_kv: int,
    structure_count: int,
) -> tuple[float, float]:
    line_kind = _infer_line_kind(base, profile)
    if line_kind == "dc":
        insulator_length_mm, height_m = _DC_STANDARD_BY_VOLTAGE.get(voltage_kv, _DEFAULT_DC_STANDARD)
        return insulator_length_mm, height_m

    insulator_length_mm, structure_heights = _AC_STANDARD_BY_VOLTAGE.get(voltage_kv, _DEFAULT_AC_STANDARD)
    return insulator_length_mm, structure_heights.get(structure_count, structure_heights[max(structure_heights)])


def _infer_line_kind(base: Mapping[str, Any], profile: Mapping[str, Any]) -> str:
    marker = "|".join(
        [
            str(base.get("tower_model") or ""),
            str(base.get("tower_type") or ""),
            str(profile.get("structure_kind") or ""),
        ]
    ).lower()
    if "直流" in marker or "zhiliu" in marker or marker.startswith("dc"):
        return "dc"
    return "ac"


def _infer_voltage_kv(base: Mapping[str, Any], profile: Mapping[str, Any]) -> int:
    raw_extra = base.get("raw_extra_json") or {}
    for candidate in (
        raw_extra.get("voltage_kv"),
        base.get("line_voltage_kv"),
        profile.get("voltage_kv"),
    ):
        parsed = _as_int(candidate)
        if parsed is not None and parsed > 0:
            return parsed

    marker = "|".join(
        [
            str(base.get("tower_model") or ""),
            str(base.get("tower_type") or ""),
            str(profile.get("structure_kind") or ""),
        ]
    )
    for voltage in (1000, 800, 750, 500, 330, 220, 110, 66, 35):
        if str(voltage) in marker:
            return voltage
    return 110


def _infer_structure_count(base: Mapping[str, Any], profile: Mapping[str, Any]) -> int:
    marker = "|".join(
        [
            str(base.get("tower_model") or ""),
            str(base.get("tower_type") or ""),
            str(profile.get("structure_kind") or ""),
        ]
    ).lower()
    if "sihuita" in marker or "四回" in marker:
        return 4
    if "guxing" in marker or "双回" in marker:
        return 2
    return 1


def _grade_insulator_length(value_mm: float | None, standard_mm: float) -> int | None:
    if value_mm is None:
        return None
    if value_mm <= standard_mm:
        return 1
    if value_mm <= 1.1 * standard_mm:
        return 2
    if value_mm <= 1.2 * standard_mm:
        return 3
    if value_mm <= 1.3 * standard_mm:
        return 4
    return 5


def _grade_ground_resistance(value: float | None) -> int | None:
    if value is None:
        return None
    if value > 20:
        return 1
    if value > 15:
        return 2
    if value > 10:
        return 3
    if value > 5:
        return 4
    return 5


def _grade_height_exposure(value: float | None, standard_m: float) -> int | None:
    if value is None:
        return None
    if value > 1.3 * standard_m:
        return 1
    if value > 1.2 * standard_m:
        return 2
    if value > 1.1 * standard_m:
        return 3
    if value > standard_m:
        return 4
    return 5


def _grade_terrain_slope(value: float | None) -> int | None:
    if value is None:
        return None
    if value > 15:
        return 1
    if value > 10:
        return 2
    if value > 5:
        return 3
    if value > 0:
        return 4
    return 5


def _grade_protection_angle(value: float | None) -> int | None:
    if value is None:
        return None
    if value > 25:
        return 1
    if value > 20:
        return 2
    if value > 15:
        return 3
    if value > 10:
        return 4
    return 5


def _compute_protection_angle_deg(base: Mapping[str, Any], profile: Mapping[str, Any]) -> float | None:
    base_geometry = base.get("circuit_geometry_json") or {}
    lightning_wire = dict(base_geometry.get("lightning_wire") or {})
    horizontal = max(
        abs(_as_float(lightning_wire.get("left_mid_distance_m")) or 0.0),
        abs(_as_float(lightning_wire.get("right_mid_distance_m")) or 0.0),
    )
    shield_wire_height = _as_float(profile.get("shield_wire_height_m")) or _as_float(lightning_wire.get("height_m"))
    top_phase_height = _max_phase_height(base, profile)
    if horizontal <= 0 or shield_wire_height is None or top_phase_height is None:
        return None
    vertical = max(shield_wire_height - top_phase_height, 0.5)
    return round(math.degrees(math.atan(horizontal / vertical)), 2)


def _max_phase_height(base: Mapping[str, Any], profile: Mapping[str, Any]) -> float | None:
    base_geometry = base.get("circuit_geometry_json") or {}
    phase_heights: list[float] = []
    for circuit_key in ("I", "II", "III", "IV"):
        circuit = base_geometry.get(circuit_key) or {}
        heights = circuit.get("phase_height_m") or {}
        for key in ("upper", "middle", "lower"):
            value = _as_float(heights.get(key))
            if value is not None:
                phase_heights.append(value)
    if not phase_heights:
        geometry_layers = profile.get("geometry_layers_json") or {}
        for circuit_key in ("I", "II", "III", "IV"):
            circuit = geometry_layers.get(circuit_key) or {}
            heights = circuit.get("phase_height_m") or {}
            for key in ("upper", "middle", "lower"):
                value = _as_float(heights.get(key))
                if value is not None:
                    phase_heights.append(value)
    return max(phase_heights) if phase_heights else None


def _missing_arrester_phases(profile: Mapping[str, Any]) -> list[str]:
    result: list[str] = []
    for phase in ("A", "B", "C"):
        value = str(profile.get(f"arrester_{phase.lower()}") or "").strip()
        if not value or value in _ARRESTER_NEGATIVE_VALUES:
            result.append(phase)
    return result


def _target_protection_angle_deg(base: Mapping[str, Any], profile: Mapping[str, Any]) -> float:
    marker = "|".join(
        [
            str(base.get("tower_model") or ""),
            str(base.get("tower_type") or ""),
            str(profile.get("structure_kind") or ""),
        ]
    ).lower()
    if any(token in marker for token in ("jiubei", "maotou")):
        return -10.0
    if any(token in marker for token in ("ganzi", "guxing", "shangzi", "zhiliu", "dc", "nz", "ky")):
        return -18.0
    return -10.0


def _normalize_insulator_length_mm(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value * 1000.0, 2) if value <= 20 else round(value, 2)


def _max_abs_float(*values: Any) -> float | None:
    parsed = [abs(number) for number in (_as_float(value) for value in values) if number is not None]
    return max(parsed) if parsed else None


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None
