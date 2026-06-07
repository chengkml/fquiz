from __future__ import annotations

from datetime import datetime

from app.services.fl_analysis_report import build_report_document, build_report_summary_payload


def _sample_report_data() -> dict[str, object]:
    return {
        "line": {
            "name": "示例线路",
            "code": "XL-001",
            "voltage_kv": 220,
        },
        "report": {
            "job_name": "示例线路-报告",
            "generated_at": datetime(2026, 6, 7, 17, 30, 0),
            "source_job_id": "risk-job-1",
            "source_job_type": "risk",
            "source_job_name": "示例线路-风险评估",
            "risk_job_id": "risk-job-1",
            "risk_job_name": "示例线路-风险评估",
            "mitigation_job_id": "mit-job-1",
            "mitigation_job_name": "示例线路-措施推荐",
        },
        "risk_rows": [
            {
                "tower_id": "tower-1",
                "tower_no": "001",
                "risk_level": "high",
                "result_json": {
                    "score": 88,
                    "cause_analysis": "接地电阻偏高；保护角暴露偏大",
                    "mitigation_recommendation": "优先降低接地电阻；优化避雷线与保护角配置",
                    "reason_details": [
                        {"code": "ground_resistance", "label": "接地电阻", "grade": 1, "triggered": True},
                        {"code": "protection_angle", "label": "保护角", "grade": 2, "triggered": True},
                    ],
                },
            },
            {
                "tower_id": "tower-2",
                "tower_no": "002",
                "risk_level": "medium",
                "result_json": {
                    "score": 56,
                    "cause_analysis": "地闪密度中等偏高",
                    "mitigation_recommendation": "按高雷区口径校核绝缘与屏蔽配置",
                    "reason_details": [
                        {"code": "lightning_density", "label": "地闪密度", "grade": 2, "triggered": True},
                    ],
                },
            },
            {
                "tower_id": "tower-3",
                "tower_no": "003",
                "risk_level": "low",
                "result_json": {
                    "score": 18,
                    "cause_analysis": "主要输入参数处于低风险区间",
                    "mitigation_recommendation": "维持现有防雷配置并保持常规巡检",
                    "reason_details": [],
                },
            },
        ],
        "selected_risk_rows": [
            {
                "tower_id": "tower-1",
                "tower_no": "001",
                "risk_level": "high",
                "result_json": {
                    "score": 88,
                    "cause_analysis": "接地电阻偏高；保护角暴露偏大",
                    "mitigation_recommendation": "优先降低接地电阻；优化避雷线与保护角配置",
                    "reason_details": [
                        {"code": "ground_resistance", "label": "接地电阻", "grade": 1, "triggered": True},
                        {"code": "protection_angle", "label": "保护角", "grade": 2, "triggered": True},
                    ],
                },
            },
            {
                "tower_id": "tower-2",
                "tower_no": "002",
                "risk_level": "medium",
                "result_json": {
                    "score": 56,
                    "cause_analysis": "地闪密度中等偏高",
                    "mitigation_recommendation": "按高雷区口径校核绝缘与屏蔽配置",
                    "reason_details": [
                        {"code": "lightning_density", "label": "地闪密度", "grade": 2, "triggered": True},
                    ],
                },
            },
        ],
        "selected_mitigation_rows": [
            {
                "tower_id": "tower-1",
                "tower_no": "001",
                "risk_level": "medium",
                "result_json": {
                    "current_risk_level": "high",
                    "expected_risk_level": "medium",
                    "recommendation_result": "需要安装避雷器",
                    "mitigation_actions": [
                        {"code": "grounding_upgrade", "label": "接地治理", "summary": "降低接地电阻"},
                        {"code": "arrester_install", "label": "安装避雷器", "summary": "关键相增设避雷器"},
                    ],
                },
            }
        ],
    }


def test_build_report_summary_payload_counts_risk_and_actions() -> None:
    summary = build_report_summary_payload(_sample_report_data())

    assert summary["selected_tower_count"] == 2
    assert summary["risk_counts"] == {"high": 1, "medium": 1, "low": 1}
    assert summary["selected_risk_counts"] == {"high": 1, "medium": 1, "low": 0}
    assert summary["post_mitigation_risk_counts"] == {"high": 0, "medium": 1, "low": 0}
    assert summary["selected_factor_trigger_counts"]["接地电阻"] == 1
    assert summary["selected_factor_trigger_counts"]["保护角"] == 1
    assert summary["selected_cause_counts"]["接地电阻偏高"] == 1
    assert summary["mitigation_action_counts"]["接地治理"] == 1
    assert summary["mitigation_action_counts"]["安装避雷器"] == 1
    assert summary["has_mitigation_data"] is True


def test_build_report_document_renders_word_compatible_html() -> None:
    filename, content = build_report_document(_sample_report_data())
    html = content.decode("utf-8")

    assert filename.endswith(".doc")
    assert "示例线路-报告" in filename
    assert "示例线路" in html
    assert "雷害风险评估结果" in html
    assert "差异化防雷措施与预期效果" in html
    assert "安装避雷器" in html
    assert "001" in html
