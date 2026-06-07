from __future__ import annotations

import math
from dataclasses import dataclass
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
_LIGHTNING_LEVEL_BASE = 400.0 + 710.0 / math.pow(10.0, 0.75)
_DEFAULT_LIGHTNING_CURRENT_A = 31.0
_DEFAULT_LIGHTNING_CURRENT_B = 2.6
_AC_RISK_THRESHOLDS = {
    35: 0.8,
    66: 0.65,
    110: 0.525,
    220: 0.315,
    330: 0.2,
    500: 0.14,
    750: 0.1,
    1000: 0.1,
}
_DC_RISK_THRESHOLDS = {
    400: 0.15,
    500: 0.15,
    660: 0.1,
    800: 0.1,
}


@dataclass(frozen=True)
class _PhasePoint:
    phase_name: str
    x_m: float
    height_m: float


@dataclass(frozen=True)
class _NormalizedLightningInputs:
    tower_no: str
    line_name: str
    tower_type: str
    tower_model: str
    structure_kind: str
    line_voltage_kv: int | None
    is_dc: bool
    ground_resistance_ohm: float | None
    lightning_density: float | None
    slope_1_deg: float
    slope_2_deg: float
    shield_wire_height_m: float | None
    insulator_length_m: float | None
    left_shield_x_m: float | None
    right_shield_x_m: float | None
    current_a: float
    current_b: float
    coupling_phase: _PhasePoint | None
    shielding_phase: _PhasePoint | None
    all_arresters_installed: bool
    synthetic_signed_geometry: bool


def grade_snapshot_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    base = dict(payload.get("base_tower_json") or {})
    profile = dict(payload.get("profile_json") or {})
    reason_details = _build_reason_details(base, profile)
    detail_map = {item["code"]: item for item in reason_details}
    formula_result = _grade_formula_snapshot_payload(payload)

    ground_resistance = _as_float(base.get("ground_resistance_ohm"))
    lightning_density = _as_float(base.get("lightning_density"))
    span_large = _as_float(base.get("span_large_m"))
    tower_type = str(base.get("tower_type") or profile.get("structure_kind") or "")
    stroke_mode = str(profile.get("stroke_mode") or "")
    arrester_values = [profile.get("arrester_a"), profile.get("arrester_b"), profile.get("arrester_c")]

    causes = _split_semicolon_text(formula_result.get("cause_analysis"))
    recommendations = _split_semicolon_text(formula_result.get("mitigation_recommendation"))

    if ground_resistance is not None:
        if ground_resistance >= 30:
            causes.append("接地电阻偏高")
            recommendations.append("优先降低接地电阻，复核接地网与冲击接地通道")
        elif ground_resistance >= 15:
            causes.append("接地电阻偏高趋势明显")

    if lightning_density is not None:
        if lightning_density >= 6:
            causes.append("地闪密度较高")
            recommendations.append("按高雷区口径校核绝缘与屏蔽配置")
        elif lightning_density >= 3:
            causes.append("地闪密度中等偏高")

    if span_large is not None:
        if span_large >= 500:
            causes.append("大号侧档距过大")
            recommendations.append("复核大跨距杆塔绝缘配合与防雷保护")
        elif span_large >= 300:
            causes.append("档距偏大")

    insulator_detail = detail_map.get("insulator_length")
    if insulator_detail:
        insulator_grade = _as_int(insulator_detail.get("grade"))
        if insulator_grade is not None and insulator_grade <= 2:
            causes.append("绝缘子串长度偏短")
            recommendations.append("提高绝缘子串长度并校核绝缘配置")
        elif insulator_grade == 3:
            causes.append("绝缘配置裕度一般")

    slope_detail = detail_map.get("terrain_slope")
    if slope_detail:
        slope_grade = _as_int(slope_detail.get("grade"))
        if slope_grade is not None and slope_grade <= 2:
            causes.append("地面倾角较大")
            recommendations.append("关注地形暴露影响并加强接地与巡检")
        elif slope_grade == 3:
            causes.append("地面倾角偏大")

    protection_detail = detail_map.get("protection_angle")
    if protection_detail:
        protection_grade = _as_int(protection_detail.get("grade"))
        if protection_grade is not None and protection_grade <= 2:
            causes.append("保护角暴露偏大")
            recommendations.append("优化避雷线与保护角配置")
        elif protection_grade == 3:
            causes.append("保护角裕度一般")

    shield_wire_detail = detail_map.get("shield_wire_height")
    shield_wire_grade = _as_int(shield_wire_detail.get("grade")) if shield_wire_detail else None
    if shield_wire_grade is not None and shield_wire_grade <= 2:
        causes.append("杆塔高度暴露偏高")
        recommendations.append("复核塔型高度与屏蔽布置")

    if "耐张" in tower_type:
        causes.append("耐张杆塔参数更敏感")

    if "反击" in stroke_mode:
        causes.append("当前以反击风险为主")
        recommendations.append("优先关注反击耐雷水平与接地改造")

    if any(str(value or "").strip() in _ARRESTER_NEGATIVE_VALUES for value in arrester_values):
        causes.append("避雷器配置不足")
        recommendations.append("补充关键相避雷器并复核安装位置")

    if not causes:
        causes.append("主要输入参数处于低风险区间")
    if not recommendations:
        recommendations.append("维持现有防雷配置并保持常规巡检")

    inputs = dict(formula_result.get("inputs") or {})
    inputs.update(
        {
            "ground_resistance_ohm": inputs.get("ground_resistance_ohm", ground_resistance),
            "lightning_density": inputs.get("lightning_density", lightning_density),
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
        }
    )

    return {
        **formula_result,
        "cause_analysis": "；".join(dict.fromkeys(causes)),
        "mitigation_recommendation": "；".join(dict.fromkeys(recommendations)),
        "reason_details": reason_details,
        "inputs": inputs,
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


def _grade_formula_snapshot_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    base = dict(payload.get("base_tower_json") or {})
    profile = dict(payload.get("profile_json") or {})
    legacy_result = _extract_legacy_lightning_result(base.get("lightning_result_json"))
    normalized = _normalize_lightning_inputs(payload)
    fallback_missing: list[str] = []

    counterstrike_withstand_ka: float | None = None
    counterstrike_trip_rate: float | None = None
    shielding_withstand_ka: float | None = None
    shielding_trip_rate: float | None = None
    coupling_details: dict[str, Any] = {}
    shielding_alpha_deg: float | None = None
    risk_index: float | None = None
    risk_threshold: float | None = None
    risk_grade: int | None = None
    severity_ratio: float | None = None
    used_legacy_fallback = False

    if normalized is not None:
        counterstrike_withstand_ka, coupling_details = _calculate_counterstrike_withstand_ka(normalized)
        shielding_withstand_ka = _calculate_shielding_withstand_ka(normalized)
        counterstrike_trip_rate = _calculate_counterstrike_trip_rate(normalized, counterstrike_withstand_ka)
        shielding_trip_rate, shielding_alpha_deg = _calculate_shielding_trip_rate(normalized, shielding_withstand_ka)
        risk_index, risk_threshold, risk_grade = _calculate_risk_grade(
            normalized,
            counterstrike_trip_rate,
            shielding_trip_rate,
        )
        severity_ratio = (
            round(risk_index / risk_threshold, 6)
            if risk_index is not None and risk_threshold not in {None, 0}
            else None
        )

    if counterstrike_withstand_ka is None:
        counterstrike_withstand_ka = legacy_result["counterstrike_withstand_ka"]
        if counterstrike_withstand_ka is not None:
            used_legacy_fallback = True
        else:
            fallback_missing.append("反击耐雷水平")
    if counterstrike_trip_rate is None:
        counterstrike_trip_rate = legacy_result["counterstrike_trip_rate"]
        if counterstrike_trip_rate is not None:
            used_legacy_fallback = True
        else:
            fallback_missing.append("反击跳闸率")
    if shielding_withstand_ka is None:
        shielding_withstand_ka = legacy_result["shielding_withstand_ka"]
        if shielding_withstand_ka is not None:
            used_legacy_fallback = True
        else:
            fallback_missing.append("绕击耐雷水平")
    if shielding_trip_rate is None:
        shielding_trip_rate = legacy_result["shielding_trip_rate"]
        if shielding_trip_rate is not None:
            used_legacy_fallback = True
        else:
            fallback_missing.append("绕击跳闸率")

    if risk_index is None or risk_threshold is None or risk_grade is None:
        legacy_grade = legacy_result["risk_grade"]
        if legacy_grade is not None:
            risk_grade = legacy_grade
            risk_index, risk_threshold, _ = _calculate_risk_grade(
                normalized,
                counterstrike_trip_rate,
                shielding_trip_rate,
            )
            if risk_index is not None and risk_threshold not in {None, 0}:
                severity_ratio = round(risk_index / risk_threshold, 6)
            used_legacy_fallback = True

    risk_level = _risk_level_from_grade(risk_grade)
    if risk_level is None:
        risk_level = legacy_result["risk_level"]
        if risk_level is not None:
            used_legacy_fallback = True

    heuristic_score = _heuristic_score(base, profile)
    if risk_level is None:
        if heuristic_score >= 70:
            risk_level = "high"
        elif heuristic_score >= 40:
            risk_level = "medium"
        else:
            risk_level = "low"

    score = _score_from_result(severity_ratio, risk_grade, heuristic_score)
    cause_analysis, mitigation_recommendation = _build_formula_explanation(
        normalized=normalized,
        counterstrike_trip_rate=counterstrike_trip_rate,
        shielding_trip_rate=shielding_trip_rate,
        risk_grade=risk_grade,
        used_legacy_fallback=used_legacy_fallback,
        fallback_missing=fallback_missing,
    )

    tower_no = str(base.get("tower_no") or "")
    summary_text = _build_formula_summary_text(
        tower_no=tower_no,
        risk_level=risk_level,
        risk_grade=risk_grade,
        counterstrike_trip_rate=counterstrike_trip_rate,
        shielding_trip_rate=shielding_trip_rate,
        used_legacy_fallback=used_legacy_fallback,
    )

    return {
        "risk_level": risk_level,
        "risk_grade": risk_grade,
        "score": score,
        "cause_analysis": cause_analysis,
        "mitigation_recommendation": mitigation_recommendation,
        "summary_text": summary_text,
        "counterstrike_withstand_ka": _rounded_value(counterstrike_withstand_ka),
        "counterstrike_trip_rate": _rounded_value(counterstrike_trip_rate),
        "shielding_withstand_ka": _rounded_value(shielding_withstand_ka),
        "shielding_trip_rate": _rounded_value(shielding_trip_rate),
        "risk_index_s": _rounded_value(risk_index),
        "risk_threshold_s": _rounded_value(risk_threshold),
        "severity_ratio": _rounded_value(severity_ratio),
        "used_legacy_fallback": used_legacy_fallback,
        "formula_source": "规程法",
        "inputs": {
            "line_voltage_kv": normalized.line_voltage_kv if normalized else _as_int(base.get("line_voltage_kv")),
            "ground_resistance_ohm": normalized.ground_resistance_ohm if normalized else _as_float(base.get("ground_resistance_ohm")),
            "lightning_density": normalized.lightning_density if normalized else _as_float(base.get("lightning_density")),
            "insulator_length_m": normalized.insulator_length_m if normalized else None,
            "shield_wire_height_m": normalized.shield_wire_height_m if normalized else None,
            "current_a": normalized.current_a if normalized else legacy_result["current_a"],
            "current_b": normalized.current_b if normalized else legacy_result["current_b"],
            "slope_1_deg": normalized.slope_1_deg if normalized else _as_float(base.get("slope_1")),
            "slope_2_deg": normalized.slope_2_deg if normalized else _as_float(base.get("slope_2")),
            "coupling_phase": (
                {
                    "phase_name": normalized.coupling_phase.phase_name,
                    "x_m": normalized.coupling_phase.x_m,
                    "height_m": normalized.coupling_phase.height_m,
                }
                if normalized and normalized.coupling_phase
                else None
            ),
            "shielding_phase": (
                {
                    "phase_name": normalized.shielding_phase.phase_name,
                    "x_m": normalized.shielding_phase.x_m,
                    "height_m": normalized.shielding_phase.height_m,
                }
                if normalized and normalized.shielding_phase
                else None
            ),
            "synthetic_signed_geometry": normalized.synthetic_signed_geometry if normalized else False,
        },
        "formula_details": {
            "coupling": coupling_details,
            "shielding_alpha_deg": _rounded_value(shielding_alpha_deg),
            "fallback_missing": fallback_missing,
        },
    }


def _extract_legacy_lightning_result(payload: Any) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}
    risk_grade = _as_int(data.get("risk_level"))
    return {
        "counterstrike_withstand_ka": _as_float(data.get("counterstroke_withstand_ka")),
        "counterstrike_trip_rate": _as_float(data.get("counterstroke_trip_rate")),
        "shielding_withstand_ka": _as_float(data.get("shielding_withstand_ka")),
        "shielding_trip_rate": _as_float(data.get("shielding_trip_rate")),
        "risk_grade": risk_grade,
        "risk_level": _risk_level_from_grade(risk_grade) or _normalize_risk_level(data.get("risk_level")),
        "current_a": _as_float(data.get("current_a")),
        "current_b": _as_float(data.get("current_b")),
    }


def _normalize_lightning_inputs(payload: Mapping[str, Any]) -> _NormalizedLightningInputs | None:
    base = payload.get("base_tower_json") or {}
    profile = payload.get("profile_json") or {}
    geometry = _merge_geometry_layers(base.get("circuit_geometry_json"), profile.get("geometry_layers_json"))
    circuits = _extract_circuit_points(geometry)
    coupling_phase, shielding_phase, synthetic_signed_geometry = _select_reference_phases(circuits)
    shield_wire = geometry.get("lightning_wire") if isinstance(geometry.get("lightning_wire"), dict) else {}

    left_shield_raw = _as_geometry_float(shield_wire.get("left_mid_distance_m"))
    right_shield_raw = _as_geometry_float(shield_wire.get("right_mid_distance_m"))
    left_shield_x_m = _normalize_horizontal_coordinate(left_shield_raw, side="left")
    right_shield_x_m = _normalize_horizontal_coordinate(right_shield_raw, side="right")
    synthetic_signed_geometry = synthetic_signed_geometry or (
        left_shield_raw is not None and left_shield_x_m is not None and not math.isclose(left_shield_raw, left_shield_x_m)
    ) or (
        right_shield_raw is not None and right_shield_x_m is not None and not math.isclose(right_shield_raw, right_shield_x_m)
    )

    if left_shield_x_m is None and right_shield_x_m is not None:
        left_shield_x_m = -abs(right_shield_x_m)
        synthetic_signed_geometry = True
    if right_shield_x_m is None and left_shield_x_m is not None:
        right_shield_x_m = abs(left_shield_x_m)
        synthetic_signed_geometry = True

    line_lightning_param_json = base.get("line_lightning_param_json") or {}
    line_voltage_kv = _as_int(base.get("line_voltage_kv"))
    tower_model = str(base.get("tower_model") or "")
    line_name = str(base.get("line_name") or "")

    if not circuits and left_shield_x_m is None and right_shield_x_m is None:
        return None

    current_a = _coalesce_positive_float(
        profile.get("current_a"),
        line_lightning_param_json.get("雷电流幅值a"),
        _DEFAULT_LIGHTNING_CURRENT_A,
    )
    current_b = _coalesce_positive_float(
        profile.get("current_b"),
        line_lightning_param_json.get("雷电流幅值b"),
        _DEFAULT_LIGHTNING_CURRENT_B,
    )

    arrester_values = tuple(
        str(value or "").strip()
        for value in (profile.get("arrester_a"), profile.get("arrester_b"), profile.get("arrester_c"))
    )
    all_arresters_installed = bool(arrester_values) and all(
        value in {"是", "已装", "1", "true", "True", "Y", "y"} for value in arrester_values if value
    )

    return _NormalizedLightningInputs(
        tower_no=str(base.get("tower_no") or ""),
        line_name=line_name,
        tower_type=str(base.get("tower_type") or ""),
        tower_model=tower_model,
        structure_kind=str(profile.get("structure_kind") or base.get("tower_type") or ""),
        line_voltage_kv=line_voltage_kv,
        is_dc=_is_dc_line(line_name=line_name, tower_model=tower_model),
        ground_resistance_ohm=_as_float(base.get("ground_resistance_ohm")),
        lightning_density=_as_float(base.get("lightning_density")),
        slope_1_deg=_as_float(base.get("slope_1")) or 0.0,
        slope_2_deg=_as_float(base.get("slope_2")) or 0.0,
        shield_wire_height_m=_coalesce_positive_float(
            profile.get("shield_wire_height_m"),
            shield_wire.get("height_m"),
        ),
        insulator_length_m=_normalize_insulator_length_m(
            profile.get("insulator_length_m"),
            geometry.get("insulator_length_mm"),
        ),
        left_shield_x_m=left_shield_x_m,
        right_shield_x_m=right_shield_x_m,
        current_a=current_a,
        current_b=current_b,
        coupling_phase=coupling_phase,
        shielding_phase=shielding_phase,
        all_arresters_installed=all_arresters_installed,
        synthetic_signed_geometry=synthetic_signed_geometry,
    )


def _merge_geometry_layers(base_geometry: Any, profile_geometry: Any) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    base_data = base_geometry if isinstance(base_geometry, dict) else {}
    profile_data = profile_geometry if isinstance(profile_geometry, dict) else {}

    for circuit in ("I", "II", "III", "IV"):
        base_layer = base_data.get(circuit) if isinstance(base_data.get(circuit), dict) else {}
        profile_layer = profile_data.get(circuit) if isinstance(profile_data.get(circuit), dict) else {}
        spacing = {
            phase: _first_defined(
                ((base_layer.get("phase_spacing_m") or {}) if isinstance(base_layer.get("phase_spacing_m"), dict) else {}).get(phase),
                ((profile_layer.get("phase_spacing_m") or {}) if isinstance(profile_layer.get("phase_spacing_m"), dict) else {}).get(phase),
            )
            for phase in ("upper", "middle", "lower")
        }
        height = {
            phase: _first_defined(
                ((base_layer.get("phase_height_m") or {}) if isinstance(base_layer.get("phase_height_m"), dict) else {}).get(phase),
                ((profile_layer.get("phase_height_m") or {}) if isinstance(profile_layer.get("phase_height_m"), dict) else {}).get(phase),
            )
            for phase in ("upper", "middle", "lower")
        }
        merged[circuit] = {"phase_spacing_m": spacing, "phase_height_m": height}

    base_wire = base_data.get("lightning_wire") if isinstance(base_data.get("lightning_wire"), dict) else {}
    profile_wire = profile_data.get("lightning_wire") if isinstance(profile_data.get("lightning_wire"), dict) else {}
    merged["lightning_wire"] = {
        "left_mid_distance_m": _first_defined(base_wire.get("left_mid_distance_m"), profile_wire.get("left_mid_distance_m")),
        "right_mid_distance_m": _first_defined(base_wire.get("right_mid_distance_m"), profile_wire.get("right_mid_distance_m")),
        "height_m": _first_defined(base_wire.get("height_m"), profile_wire.get("height_m")),
    }
    merged["insulator_length_mm"] = _first_defined(base_data.get("insulator_length_mm"), profile_data.get("insulator_length_mm"))
    merged["tower_height_m"] = _first_defined(base_data.get("tower_height_m"), profile_data.get("tower_height_m"))
    return merged


def _extract_circuit_points(geometry: dict[str, Any]) -> list[tuple[str, dict[str, _PhasePoint], list[_PhasePoint]]]:
    circuits: list[tuple[str, dict[str, _PhasePoint], list[_PhasePoint]]] = []
    for circuit in ("I", "II", "III", "IV"):
        layer = geometry.get(circuit)
        if not isinstance(layer, dict):
            continue
        spacing = layer.get("phase_spacing_m") if isinstance(layer.get("phase_spacing_m"), dict) else {}
        height = layer.get("phase_height_m") if isinstance(layer.get("phase_height_m"), dict) else {}
        points: list[_PhasePoint] = []
        for phase_name in ("upper", "middle", "lower"):
            x_m = _as_geometry_float(spacing.get(phase_name))
            height_m = _as_geometry_float(height.get(phase_name))
            if x_m is None or height_m is None or height_m <= 0:
                continue
            points.append(_PhasePoint(phase_name=phase_name, x_m=x_m, height_m=height_m))
        if points:
            circuits.append((circuit, {point.phase_name: point for point in points}, points))
    return circuits


def _select_reference_phases(
    circuits: list[tuple[str, dict[str, _PhasePoint], list[_PhasePoint]]],
) -> tuple[_PhasePoint | None, _PhasePoint | None, bool]:
    if not circuits:
        return None, None, False

    if len(circuits) >= 4:
        coupling_candidate = circuits[0][1].get("upper") or min(circuits[0][2], key=lambda item: item.x_m)
        shielding_candidate = circuits[-1][1].get("middle") or max(circuits[-1][2], key=lambda item: item.x_m)
    elif len(circuits) >= 2:
        coupling_candidate = circuits[0][1].get("upper") or min(circuits[0][2], key=lambda item: item.x_m)
        shielding_candidate = (
            circuits[1][1].get("middle")
            or circuits[0][1].get("middle")
            or max(circuits[1][2], key=lambda item: item.x_m)
        )
    else:
        coupling_candidate = min(circuits[0][2], key=lambda item: item.x_m)
        shielding_candidate = max(circuits[0][2], key=lambda item: item.x_m)

    coupling_phase, changed_left = _force_phase_side(coupling_candidate, side="left")
    shielding_phase, changed_right = _force_phase_side(shielding_candidate, side="right")
    return coupling_phase, shielding_phase, changed_left or changed_right


def _force_phase_side(point: _PhasePoint | None, *, side: str) -> tuple[_PhasePoint | None, bool]:
    if point is None:
        return None, False
    target_x = point.x_m
    if side == "left" and point.x_m > 0:
        target_x = -abs(point.x_m)
    elif side == "right" and point.x_m < 0:
        target_x = abs(point.x_m)
    changed = not math.isclose(point.x_m, target_x, abs_tol=1e-9)
    return _PhasePoint(phase_name=point.phase_name, x_m=target_x, height_m=point.height_m), changed


def _calculate_counterstrike_withstand_ka(
    normalized: _NormalizedLightningInputs,
) -> tuple[float | None, dict[str, Any]]:
    if (
        normalized.insulator_length_m is None
        or normalized.shield_wire_height_m is None
        or normalized.shield_wire_height_m <= 0
        or normalized.ground_resistance_ohm is None
        or normalized.coupling_phase is None
        or normalized.left_shield_x_m is None
        or normalized.right_shield_x_m is None
    ):
        return None, {}

    coupling = _calculate_coupling_coefficients(normalized)
    if not coupling:
        return None, {}

    denominator = (
        (1.0 - coupling["k"]) * _counterstrike_level_coefficient(normalized) * normalized.ground_resistance_ohm
        + (coupling["ha"] / normalized.shield_wire_height_m - coupling["k"])
        * _counterstrike_level_coefficient(normalized)
        * (0.5 * normalized.shield_wire_height_m)
        / 2.6
        + (coupling["y3"] - coupling["y1"] * coupling["k0"]) / 2.6
    )
    if math.isclose(denominator, 0.0, abs_tol=1e-9):
        return None, coupling

    current_ka = abs(normalized.insulator_length_m * _LIGHTNING_LEVEL_BASE / denominator) * 0.7
    current_ka = min(max(current_ka, 0.0), 2000.0)
    return round(current_ka, 4), {**coupling, "denominator": round(denominator, 6)}


def _calculate_coupling_coefficients(normalized: _NormalizedLightningInputs) -> dict[str, float]:
    if (
        normalized.coupling_phase is None
        or normalized.left_shield_x_m is None
        or normalized.right_shield_x_m is None
        or normalized.shield_wire_height_m is None
        or normalized.insulator_length_m is None
    ):
        return {}

    coupling_factor = _calculate_coupling_factor(normalized)
    shield_offset = _shield_offset_for_voltage(normalized)
    conductor_offset = _conductor_offset_for_voltage(normalized)

    y1 = normalized.shield_wire_height_m - shield_offset * 2.0 / 3.0
    y3 = normalized.coupling_phase.height_m - conductor_offset * 2.0 / 3.0 - normalized.insulator_length_m

    if y1 <= 0:
        return {}

    right_distance = math.hypot(normalized.right_shield_x_m - normalized.coupling_phase.x_m, y1 - y3)
    right_image_distance = math.hypot(normalized.right_shield_x_m - normalized.coupling_phase.x_m, y1 + y3)
    left_distance = math.hypot(normalized.left_shield_x_m - normalized.coupling_phase.x_m, y1 - y3)
    left_image_distance = math.hypot(normalized.left_shield_x_m - normalized.coupling_phase.x_m, y1 + y3)
    shield_span = math.hypot(normalized.left_shield_x_m - normalized.right_shield_x_m, 0.0)
    shield_image_span = math.hypot(normalized.left_shield_x_m - normalized.right_shield_x_m, 2.0 * y1)

    if min(right_distance, right_image_distance, left_distance, left_image_distance, shield_span) <= 0:
        return {}

    base_log = math.log(2.0 * y1 / 0.0055)
    span_log = math.log(shield_image_span / shield_span)
    right_log = math.log(right_image_distance / right_distance)
    left_log = math.log(left_image_distance / left_distance)

    if math.isclose(base_log + span_log, 0.0, abs_tol=1e-9):
        return {}

    k0 = (right_log + left_log) / (base_log + span_log)
    k = coupling_factor * k0
    return {
        "k": round(k, 6),
        "k0": round(k0, 6),
        "y1": round(y1, 6),
        "y3": round(y3, 6),
        "ha": round(normalized.coupling_phase.height_m, 6),
    }


def _calculate_shielding_withstand_ka(normalized: _NormalizedLightningInputs) -> float | None:
    if normalized.insulator_length_m is None:
        return None
    current_ka = normalized.insulator_length_m * _LIGHTNING_LEVEL_BASE / 100.0
    current_ka = min(max(current_ka, 0.0), 1000.0)
    return round(current_ka, 4)


def _calculate_counterstrike_trip_rate(
    normalized: _NormalizedLightningInputs,
    counterstrike_withstand_ka: float | None,
) -> float | None:
    span_factor = _trip_span_factor(normalized)
    if (
        counterstrike_withstand_ka is None
        or normalized.lightning_density is None
        or normalized.shield_wire_height_m is None
        or normalized.right_shield_x_m is None
        or normalized.current_a <= 0
        or normalized.current_b <= 0
    ):
        return None
    denominator = 6.0 if _is_gentle_slope(normalized) else 4.0
    trip_rate = (
        0.1
        * normalized.lightning_density
        * span_factor
        * _counterstrike_trip_arc_rate(normalized)
        / denominator
        / (1.0 + math.pow(counterstrike_withstand_ka / normalized.current_a, normalized.current_b))
    )
    return round(max(trip_rate, 0.0), 6)


def _calculate_shielding_trip_rate(
    normalized: _NormalizedLightningInputs,
    shielding_withstand_ka: float | None,
) -> tuple[float | None, float | None]:
    if (
        shielding_withstand_ka is None
        or normalized.lightning_density is None
        or normalized.shield_wire_height_m is None
        or normalized.right_shield_x_m is None
        or normalized.shielding_phase is None
        or normalized.current_a <= 0
        or normalized.current_b <= 0
    ):
        return None, None

    height_gap = normalized.shield_wire_height_m - normalized.shielding_phase.height_m
    if "直线" in normalized.structure_kind:
        height_gap += normalized.insulator_length_m or 0.0
    if math.isclose(height_gap, 0.0, abs_tol=1e-9):
        return None, None

    alpha_deg = math.degrees(math.atan((normalized.shielding_phase.x_m - normalized.right_shield_x_m) / height_gap))
    exponent_shift = 3.9 if _is_gentle_slope(normalized) else 3.35
    trip_rate = (
        0.1
        * normalized.lightning_density
        * _trip_span_factor(normalized)
        * _shielding_trip_arc_rate(normalized)
        * math.pow(10.0, alpha_deg * math.sqrt(normalized.shield_wire_height_m) / 86.0 - exponent_shift)
        / (1.0 + math.pow(shielding_withstand_ka / normalized.current_a, normalized.current_b))
    )
    return round(max(trip_rate, 0.0), 6), round(alpha_deg, 6)


def _calculate_risk_grade(
    normalized: _NormalizedLightningInputs | None,
    counterstrike_trip_rate: float | None,
    shielding_trip_rate: float | None,
) -> tuple[float | None, float | None, int | None]:
    density = normalized.lightning_density if normalized else None
    threshold = _risk_threshold(normalized) if normalized else None
    if density is None or density <= 0 or threshold is None:
        return None, threshold, None
    if counterstrike_trip_rate is None and shielding_trip_rate is None:
        return None, threshold, None

    total_trip_rate = max((counterstrike_trip_rate or 0.0) + (shielding_trip_rate or 0.0), 0.0)
    risk_index = total_trip_rate * 2.78 / density if total_trip_rate > 0 else 0.0
    if risk_index <= threshold:
        return round(risk_index, 6), threshold, 1
    if risk_index <= 1.5 * threshold:
        return round(risk_index, 6), threshold, 2
    if risk_index <= 3.0 * threshold:
        return round(risk_index, 6), threshold, 3
    return round(risk_index, 6), threshold, 4


def _build_formula_explanation(
    *,
    normalized: _NormalizedLightningInputs | None,
    counterstrike_trip_rate: float | None,
    shielding_trip_rate: float | None,
    risk_grade: int | None,
    used_legacy_fallback: bool,
    fallback_missing: list[str],
) -> tuple[str, str]:
    causes: list[str] = []
    recommendations: list[str] = []

    if risk_grade is not None:
        causes.append(f"规程法雷击风险等级为 {risk_grade} 级")
    if counterstrike_trip_rate is not None and shielding_trip_rate is not None:
        if counterstrike_trip_rate >= max(shielding_trip_rate * 5.0, shielding_trip_rate + 0.05):
            causes.append("反击跳闸率明显高于绕击跳闸率")
            recommendations.append("优先降低接地电阻并复核杆塔耦合与接地通道")
        elif shielding_trip_rate >= max(counterstrike_trip_rate * 2.0, counterstrike_trip_rate + 0.02):
            causes.append("绕击跳闸率占主导")
            recommendations.append("优先优化避雷线保护角与导线屏蔽关系")

    if normalized is not None:
        if normalized.ground_resistance_ohm is not None:
            if normalized.ground_resistance_ohm >= 25:
                causes.append("接地电阻偏高")
                recommendations.append("建议优先实施接地降阻治理")
            elif normalized.ground_resistance_ohm >= 15:
                causes.append("接地电阻有偏高趋势")
        if normalized.lightning_density is not None:
            if normalized.lightning_density >= 6:
                causes.append("地闪密度位于高雷区")
                recommendations.append("建议按高雷区口径复核绝缘与屏蔽配置")
            elif normalized.lightning_density >= 3:
                causes.append("地闪密度中等偏高")
        if normalized.insulator_length_m is not None and normalized.insulator_length_m < 3.0:
            causes.append("绝缘子串长度偏短")
            recommendations.append("建议复核绝缘配合和塔头布置")
        if normalized.synthetic_signed_geometry:
            causes.append("导线左右位置信息缺失，当前按对称坐标近似")
        if normalized.all_arresters_installed:
            recommendations.append("全相装设避雷器的场景建议再用 ATP 方法复核")

    if used_legacy_fallback:
        causes.append("部分规程法输入缺失，已回退到已保存的历史结果")
    if fallback_missing:
        recommendations.append("补齐以下输入可提升结果可信度: " + "、".join(dict.fromkeys(fallback_missing)))
    if risk_grade is not None and risk_grade >= 3:
        recommendations.append("建议将该塔纳入优先治理清单并安排复测")

    if not causes:
        causes.append("当前输入下未见显著高风险因素")
    if not recommendations:
        recommendations.append("维持现有防雷配置并保持常规巡检")

    return "；".join(dict.fromkeys(causes)), "；".join(dict.fromkeys(recommendations))


def _build_formula_summary_text(
    *,
    tower_no: str,
    risk_level: str,
    risk_grade: int | None,
    counterstrike_trip_rate: float | None,
    shielding_trip_rate: float | None,
    used_legacy_fallback: bool,
) -> str:
    tower_label = tower_no or "当前杆塔"
    parts = [f"{tower_label}评估为{risk_level}风险"]
    if risk_grade is not None:
        parts.append(f"规程法等级 {risk_grade}")
    if counterstrike_trip_rate is not None:
        parts.append(f"反击跳闸率 {counterstrike_trip_rate:.4f}")
    if shielding_trip_rate is not None:
        parts.append(f"绕击跳闸率 {shielding_trip_rate:.4f}")
    if used_legacy_fallback:
        parts.append("含历史结果回退")
    return "，".join(parts)


def _risk_level_from_grade(risk_grade: int | None) -> str | None:
    if risk_grade is None:
        return None
    if risk_grade <= 1:
        return "low"
    if risk_grade == 2:
        return "medium"
    return "high"


def _normalize_risk_level(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text:
        return None
    if text in {"1", "low", "低", "低风险"}:
        return "low"
    if text in {"2", "medium", "中", "中风险"}:
        return "medium"
    if text in {"3", "4", "high", "高", "高风险"}:
        return "high"
    return None


def _score_from_result(severity_ratio: float | None, risk_grade: int | None, heuristic_score: int) -> int:
    if severity_ratio is not None and severity_ratio >= 0:
        return int(round(min(max(severity_ratio, 0.0), 4.0) / 4.0 * 100))
    if risk_grade is not None:
        return {1: 25, 2: 45, 3: 70, 4: 90}.get(risk_grade, heuristic_score)
    return heuristic_score


def _heuristic_score(base: Mapping[str, Any], profile: Mapping[str, Any]) -> int:
    score = 0
    ground_resistance = _as_float(base.get("ground_resistance_ohm"))
    lightning_density = _as_float(base.get("lightning_density"))
    span_large = _as_float(base.get("span_large_m"))
    arrester_values = (profile.get("arrester_a"), profile.get("arrester_b"), profile.get("arrester_c"))

    if ground_resistance is not None:
        if ground_resistance >= 30:
            score += 35
        elif ground_resistance >= 15:
            score += 18
    if lightning_density is not None:
        if lightning_density >= 6:
            score += 25
        elif lightning_density >= 3:
            score += 12
    if span_large is not None:
        if span_large >= 500:
            score += 20
        elif span_large >= 300:
            score += 10
    if any(str(value or "").strip() in {"否", "无", "未装", "0"} for value in arrester_values):
        score += 15
    return min(score, 100)


def _calculate_coupling_factor(normalized: _NormalizedLightningInputs) -> float:
    voltage = normalized.line_voltage_kv or 0
    if normalized.is_dc:
        return 1.28
    if voltage in {35, 66}:
        return 1.15
    if voltage == 110:
        return 1.2
    if voltage == 220:
        return 1.25
    if voltage >= 500:
        return 1.28
    return 1.2


def _shield_offset_for_voltage(normalized: _NormalizedLightningInputs) -> float:
    voltage = normalized.line_voltage_kv or 0
    if normalized.is_dc:
        return 9.5
    if voltage in {35, 66}:
        return 1.1
    if voltage == 110:
        return 2.8
    if voltage == 220:
        return 7.0
    if voltage >= 500:
        return 9.5
    return 2.8


def _conductor_offset_for_voltage(normalized: _NormalizedLightningInputs) -> float:
    voltage = normalized.line_voltage_kv or 0
    if normalized.is_dc:
        return 12.0
    if voltage in {35, 66}:
        return 1.8
    if voltage == 110:
        return 5.3
    if voltage >= 220:
        return 12.0
    return 5.3


def _counterstrike_level_coefficient(normalized: _NormalizedLightningInputs) -> float:
    voltage = normalized.line_voltage_kv or 0
    if normalized.is_dc:
        return 0.9
    if voltage in {35, 66}:
        return 0.84
    if voltage == 110:
        return 0.86
    if voltage in {220, 330, 500}:
        return 0.88
    if voltage == 750:
        return 0.89
    if voltage > 750:
        return 0.9
    return 0.88


def _counterstrike_trip_arc_rate(normalized: _NormalizedLightningInputs) -> float:
    voltage = normalized.line_voltage_kv or 0
    if voltage == 110:
        return 0.85
    if voltage == 220:
        return 0.918
    return 1.0


def _shielding_trip_arc_rate(normalized: _NormalizedLightningInputs) -> float:
    voltage = normalized.line_voltage_kv or 0
    if voltage in {35, 66}:
        return 0.8
    if voltage == 110:
        return 0.85
    if voltage == 220:
        return 0.918
    if voltage == 330:
        return 0.95
    return 1.0


def _trip_span_factor(normalized: _NormalizedLightningInputs) -> float:
    if normalized.shield_wire_height_m is None or normalized.right_shield_x_m is None:
        return 0.0
    return 2.0 * abs(normalized.right_shield_x_m) + 4.0 * normalized.shield_wire_height_m


def _risk_threshold(normalized: _NormalizedLightningInputs | None) -> float | None:
    if normalized is None:
        return None
    voltage = normalized.line_voltage_kv or 0
    if normalized.is_dc:
        if voltage >= 800:
            return _DC_RISK_THRESHOLDS[800]
        if voltage >= 660:
            return _DC_RISK_THRESHOLDS[660]
        if voltage >= 400:
            return _DC_RISK_THRESHOLDS[500]
        return 0.15
    if voltage >= 1000:
        return _AC_RISK_THRESHOLDS[1000]
    if voltage >= 750:
        return _AC_RISK_THRESHOLDS[750]
    if voltage >= 500:
        return _AC_RISK_THRESHOLDS[500]
    if voltage >= 330:
        return _AC_RISK_THRESHOLDS[330]
    if voltage >= 220:
        return _AC_RISK_THRESHOLDS[220]
    if voltage >= 110:
        return _AC_RISK_THRESHOLDS[110]
    if voltage >= 66:
        return _AC_RISK_THRESHOLDS[66]
    if voltage >= 35:
        return _AC_RISK_THRESHOLDS[35]
    return 0.1


def _normalize_insulator_length_m(profile_value: Any, geometry_value: Any) -> float | None:
    raw_value = _first_defined(profile_value, geometry_value)
    value = _as_float(raw_value)
    if value is None or value <= 0:
        return None
    if value > 50:
        return round(value / 1000.0, 6)
    return round(value, 6)


def _normalize_horizontal_coordinate(value: float | None, *, side: str) -> float | None:
    if value is None:
        return None
    if side == "left":
        return value if value < 0 else -abs(value)
    return value if value > 0 else abs(value)


def _coalesce_positive_float(*values: Any) -> float:
    for value in values:
        parsed = _as_float(value)
        if parsed is not None and parsed > 0:
            return parsed
    return 0.0


def _split_semicolon_text(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    return [item for item in text.split("；") if item]


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


def _first_defined(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _as_geometry_float(value: Any) -> float | None:
    parsed = _as_float(value)
    if parsed is None:
        return None
    if math.isclose(parsed, -1.0, abs_tol=1e-9):
        return None
    return parsed


def _is_dc_line(*, line_name: str, tower_model: str) -> bool:
    tower_model_lower = tower_model.lower()
    return (
        "直流" in line_name
        or tower_model_lower.startswith("dc")
        or "zhiliu" in tower_model_lower
        or "vzhiliu" in tower_model_lower
    )


def _is_gentle_slope(normalized: _NormalizedLightningInputs) -> bool:
    return abs(normalized.slope_1_deg) < 10.0 and abs(normalized.slope_2_deg) < 10.0


def _rounded_value(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 6)
