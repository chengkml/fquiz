from __future__ import annotations

import unittest

from app.services.fl_analysis_rules import grade_mitigation_snapshot_payload, grade_snapshot_payload


class FlAnalysisRulesTest(unittest.TestCase):
    def test_grade_snapshot_payload_marks_high_risk_and_actions(self) -> None:
        payload = {
            "base_tower_json": {
                "tower_no": "T001",
                "tower_type": "耐张",
                "ground_resistance_ohm": 35.0,
                "lightning_density": 6.5,
                "span_large_m": 620.0,
                "line_voltage_kv": 110,
                "slope_1": 18.0,
                "slope_2": 6.0,
                "circuit_geometry_json": {
                    "I": {
                        "phase_height_m": {"upper": 28.0, "middle": 24.0, "lower": 20.0},
                    },
                    "lightning_wire": {
                        "left_mid_distance_m": 9.0,
                        "right_mid_distance_m": 9.0,
                        "height_m": 32.0,
                    },
                },
            },
            "profile_json": {
                "structure_kind": "耐张",
                "stroke_mode": "反击",
                "arrester_a": "否",
                "arrester_b": "否",
                "arrester_c": "否",
                "insulator_length_m": 1200.0,
            },
        }

        result = grade_snapshot_payload(payload)

        self.assertEqual(result["risk_level"], "high")
        self.assertGreaterEqual(result["score"], 80)
        self.assertIn("接地电阻偏高", result["cause_analysis"])
        self.assertIn("避雷器", result["mitigation_recommendation"])
        self.assertTrue(any(item["code"] == "insulator_length" for item in result["reason_details"]))

    def test_grade_snapshot_payload_marks_low_risk_when_inputs_are_good(self) -> None:
        payload = {
            "base_tower_json": {
                "tower_no": "T002",
                "tower_type": "直线",
                "ground_resistance_ohm": 4.0,
                "lightning_density": 1.5,
                "span_large_m": 180.0,
                "line_voltage_kv": 110,
            },
            "profile_json": {
                "structure_kind": "直线",
                "stroke_mode": "绕击",
                "arrester_a": "是",
                "arrester_b": "是",
                "arrester_c": "是",
                "insulator_length_m": 1800.0,
            },
        }

        result = grade_snapshot_payload(payload)

        self.assertEqual(result["risk_level"], "low")
        self.assertLess(result["score"], 40)
        self.assertTrue(result["cause_analysis"])
        self.assertTrue(result["mitigation_recommendation"])

    def test_grade_mitigation_snapshot_payload_builds_actions_and_reduces_expected_risk(self) -> None:
        payload = {
            "base_tower_json": {
                "tower_no": "T003",
                "tower_type": "耐张",
                "ground_resistance_ohm": 28.0,
                "lightning_density": 5.0,
                "span_large_m": 420.0,
                "line_voltage_kv": 220,
                "slope_1": 12.0,
                "slope_2": 8.0,
                "circuit_geometry_json": {
                    "I": {
                        "phase_height_m": {"upper": 36.0, "middle": 32.0, "lower": 28.0},
                    },
                    "lightning_wire": {
                        "left_mid_distance_m": 8.5,
                        "right_mid_distance_m": 8.5,
                        "height_m": 40.0,
                    },
                },
            },
            "profile_json": {
                "structure_kind": "耐张",
                "stroke_mode": "反击",
                "arrester_a": "否",
                "arrester_b": "否",
                "arrester_c": "否",
                "insulator_length_m": 2000.0,
            },
        }

        result = grade_mitigation_snapshot_payload(payload, non_construction=False)

        self.assertIn(result["recommendation_result"], {"需要安装避雷器", "不需要安装避雷器"})
        self.assertTrue(result["mitigation_actions"])
        self.assertLess(result["expected_score"], result["current_score"])
        self.assertTrue(any(action["code"] == "grounding_upgrade" for action in result["mitigation_actions"]))

    def test_grade_mitigation_snapshot_payload_includes_non_construction_action(self) -> None:
        payload = {
            "base_tower_json": {
                "tower_no": "T004",
                "tower_model": "s220guxing",
                "tower_type": "直线",
                "ground_resistance_ohm": 16.0,
                "lightning_density": 3.5,
                "span_large_m": 260.0,
                "line_voltage_kv": 220,
                "circuit_geometry_json": {
                    "I": {
                        "phase_height_m": {"upper": 30.0, "middle": 26.0, "lower": 22.0},
                    },
                    "lightning_wire": {
                        "left_mid_distance_m": 10.0,
                        "right_mid_distance_m": 10.0,
                        "height_m": 33.0,
                    },
                },
            },
            "profile_json": {
                "structure_kind": "直线",
                "stroke_mode": "绕击",
                "arrester_a": "是",
                "arrester_b": "是",
                "arrester_c": "是",
                "insulator_length_m": 2500.0,
            },
        }

        result = grade_mitigation_snapshot_payload(payload, non_construction=True)

        self.assertTrue(result["non_construction"])
        self.assertTrue(any(action["code"] == "shielding_geometry" for action in result["mitigation_actions"]))

    def test_grade_mitigation_snapshot_payload_prefers_source_risk_result(self) -> None:
        payload = {
            "base_tower_json": {
                "tower_no": "T005",
                "tower_type": "直线",
                "ground_resistance_ohm": 4.0,
                "lightning_density": 1.5,
                "span_large_m": 180.0,
                "line_voltage_kv": 110,
            },
            "profile_json": {
                "structure_kind": "直线",
                "stroke_mode": "绕击",
                "arrester_a": "是",
                "arrester_b": "是",
                "arrester_c": "是",
                "insulator_length_m": 1800.0,
            },
            "source_result_json": {
                "risk_level": "high",
                "score": 92,
                "cause_analysis": "沿用前驱风险结果",
                "reason_details": [{"code": "source_reason", "label": "前驱原因"}],
                "inputs": {"ground_resistance_ohm": 35.0},
            },
        }

        result = grade_mitigation_snapshot_payload(payload, non_construction=False)

        self.assertEqual(result["current_risk_level"], "high")
        self.assertEqual(result["current_score"], 92)
        self.assertEqual(result["cause_analysis"], "沿用前驱风险结果")
        self.assertEqual(result["reason_details"][0]["code"], "source_reason")


if __name__ == "__main__":
    unittest.main()
