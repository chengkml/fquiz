from __future__ import annotations

from collections import Counter
from datetime import datetime
from html import escape
from typing import Any, Mapping, Sequence


_RISK_LEVEL_LABELS = {
    "high": "高风险",
    "medium": "中风险",
    "low": "低风险",
}


def build_report_filename(
    *,
    line_name: str | None,
    report_job_name: str | None,
    generated_at: datetime,
) -> str:
    base_name = _sanitize_filename(report_job_name or line_name or "防雷分析")
    timestamp = generated_at.strftime("%Y%m%d%H%M%S")
    return f"{base_name}-防雷报告-{timestamp}.doc"


def build_report_summary_payload(report_data: Mapping[str, Any]) -> dict[str, Any]:
    report = _read_mapping(report_data, "report")
    risk_rows = _read_rows(report_data, "risk_rows")
    selected_risk_rows = _read_rows(report_data, "selected_risk_rows")
    selected_mitigation_rows = _read_rows(report_data, "selected_mitigation_rows")

    factor_counts: Counter[str] = Counter()
    cause_counts: Counter[str] = Counter()
    action_counts: Counter[str] = Counter()

    for row in selected_risk_rows:
        result_json = _read_mapping(row, "result_json")
        for detail in _read_sequence(result_json, "reason_details"):
            label = str(detail.get("label") or detail.get("code") or "-").strip()
            if not label:
                continue
            grade = _as_int(detail.get("grade"))
            triggered = bool(detail.get("triggered"))
            if triggered or (grade is not None and grade <= 2):
                factor_counts[label] += 1
        for item in _split_cn_list(result_json.get("cause_analysis")):
            cause_counts[item] += 1

    for row in selected_mitigation_rows:
        result_json = _read_mapping(row, "result_json")
        for action in _read_sequence(result_json, "mitigation_actions"):
            label = str(action.get("label") or action.get("code") or "-").strip()
            if label:
                action_counts[label] += 1

    generated_at = report.get("generated_at")
    filename = build_report_filename(
        line_name=_read_mapping(report_data, "line").get("name"),
        report_job_name=_as_optional_str(report.get("job_name")),
        generated_at=generated_at if isinstance(generated_at, datetime) else datetime.utcnow(),
    )

    return {
        "report_kind": "fl-analysis",
        "generated_at": generated_at.isoformat() if isinstance(generated_at, datetime) else None,
        "document_filename": filename,
        "source_job_id": _as_optional_str(report.get("source_job_id")),
        "source_job_type": _as_optional_str(report.get("source_job_type")),
        "source_job_name": _as_optional_str(report.get("source_job_name")),
        "risk_job_id": _as_optional_str(report.get("risk_job_id")),
        "risk_job_name": _as_optional_str(report.get("risk_job_name")),
        "mitigation_job_id": _as_optional_str(report.get("mitigation_job_id")),
        "mitigation_job_name": _as_optional_str(report.get("mitigation_job_name")),
        "selected_tower_count": len(selected_risk_rows),
        "report_row_count": len(selected_mitigation_rows),
        "risk_counts": _count_risk_levels(risk_rows),
        "selected_risk_counts": _count_risk_levels(selected_risk_rows),
        "post_mitigation_risk_counts": _count_risk_levels(selected_mitigation_rows),
        "selected_factor_trigger_counts": dict(factor_counts.most_common()),
        "selected_cause_counts": dict(cause_counts.most_common()),
        "mitigation_action_counts": dict(action_counts.most_common()),
        "has_mitigation_data": bool(selected_mitigation_rows),
    }


def build_report_document(report_data: Mapping[str, Any]) -> tuple[str, bytes]:
    line = _read_mapping(report_data, "line")
    report = _read_mapping(report_data, "report")
    risk_rows = _read_rows(report_data, "risk_rows")
    selected_risk_rows = _read_rows(report_data, "selected_risk_rows")
    selected_mitigation_rows = _read_rows(report_data, "selected_mitigation_rows")
    summary = build_report_summary_payload(report_data)

    generated_at = report.get("generated_at")
    if isinstance(generated_at, datetime):
        generated_at_text = generated_at.strftime("%Y-%m-%d %H:%M:%S")
    else:
        generated_at_text = "-"

    source_job_type = _format_job_type(_as_optional_str(report.get("source_job_type")))
    source_job_name = _as_optional_str(report.get("source_job_name")) or "-"
    mitigation_job_name = _as_optional_str(report.get("mitigation_job_name")) or "未关联措施任务"

    factor_rows = [
        [label, str(count)]
        for label, count in summary["selected_factor_trigger_counts"].items()
    ] or [["未命中重点风险因子", "0"]]

    cause_rows = [
        [label, str(count)]
        for label, count in summary["selected_cause_counts"].items()
    ] or [["未提取到高风险原因", "0"]]

    risk_table_rows = []
    for row in selected_risk_rows:
        result_json = _read_mapping(row, "result_json")
        risk_table_rows.append(
            [
                _display(row.get("tower_no")),
                _format_risk_level(row.get("risk_level")),
                _display(result_json.get("score")),
                _display(result_json.get("cause_analysis")),
                _display(result_json.get("mitigation_recommendation")),
            ]
        )

    mitigation_table_rows = []
    for row in selected_mitigation_rows:
        result_json = _read_mapping(row, "result_json")
        mitigation_table_rows.append(
            [
                _display(row.get("tower_no")),
                _format_risk_level(result_json.get("current_risk_level")),
                _format_risk_level(result_json.get("expected_risk_level") or row.get("risk_level")),
                _join_action_summaries(result_json),
                _display(result_json.get("recommendation_result")),
            ]
        )

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{escape(summary["document_filename"])}</title>
  <style>
    body {{
      font-family: "SimSun", "Noto Serif CJK SC", serif;
      font-size: 12pt;
      line-height: 1.65;
      color: #222;
      margin: 28px 36px;
    }}
    h1, h2, h3 {{
      color: #0f2742;
      margin: 0 0 12px;
    }}
    h1 {{
      font-size: 22pt;
      text-align: center;
      margin-top: 24px;
    }}
    h2 {{
      font-size: 16pt;
      margin-top: 28px;
      border-bottom: 1px solid #c8d3df;
      padding-bottom: 4px;
    }}
    h3 {{
      font-size: 13pt;
      margin-top: 18px;
    }}
    p {{
      margin: 8px 0;
      text-indent: 2em;
    }}
    .meta {{
      margin: 20px auto 0;
      width: 100%;
      border-collapse: collapse;
    }}
    .meta td {{
      border: 1px solid #cad5df;
      padding: 8px 10px;
      vertical-align: top;
    }}
    table.data {{
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 18px;
      table-layout: fixed;
    }}
    table.data th,
    table.data td {{
      border: 1px solid #cad5df;
      padding: 8px 10px;
      vertical-align: top;
      word-break: break-word;
    }}
    table.data th {{
      background: #edf3f8;
      font-weight: 700;
    }}
    .muted {{
      color: #5f6c7b;
      text-indent: 0;
    }}
  </style>
</head>
<body>
  <h1>{escape(_display(report.get("job_name") or line.get("name") or "防雷报告"))}</h1>
  <table class="meta">
    <tr>
      <td><strong>线路名称</strong><br />{escape(_display(line.get("name")))}</td>
      <td><strong>线路编码</strong><br />{escape(_display(line.get("code")))}</td>
      <td><strong>电压等级</strong><br />{escape(_display(line.get("voltage_kv")))} kV</td>
    </tr>
    <tr>
      <td><strong>生成时间</strong><br />{escape(generated_at_text)}</td>
      <td><strong>报告来源</strong><br />{escape(source_job_type)} / {escape(source_job_name)}</td>
      <td><strong>关联措施任务</strong><br />{escape(mitigation_job_name)}</td>
    </tr>
  </table>

  <h2>一、线路概况</h2>
  <p>本报告基于线路既有防雷分析任务结果生成，复用了源端“先形成任务结果，再按杆塔勾选纳入报告范围”的工作流。当前线路共纳入 {len(selected_risk_rows)} 座重点杆塔进行报告输出，原始风险评估覆盖 {len(risk_rows)} 座杆塔。</p>

  <h2>二、重点风险因子概览</h2>
  <p>针对纳入报告的重点杆塔，统计其已触发或达到重点阈值的风险因子，用于快速识别本线路防雷薄弱项。</p>
  {_render_table(["风险因子", "命中杆塔数"], factor_rows)}

  <h3>高风险原因分布</h3>
  {_render_table(["原因", "出现次数"], cause_rows)}

  <h2>三、雷害风险评估结果</h2>
  <p>线路整体风险分布为：高风险 {summary["risk_counts"]["high"]} 座，中风险 {summary["risk_counts"]["medium"]} 座，低风险 {summary["risk_counts"]["low"]} 座。纳入报告的重点杆塔中，高风险 {summary["selected_risk_counts"]["high"]} 座，中风险 {summary["selected_risk_counts"]["medium"]} 座。</p>
  {_render_table(["杆塔号", "风险等级", "得分", "高风险原因", "措施建议"], risk_table_rows or [["-", "-", "-", "当前任务暂无重点杆塔结果", "-"]])}

  <h2>四、差异化防雷措施与预期效果</h2>
  <p>若已存在关联的措施推荐任务，则下表展示当前风险、建议后风险以及推荐动作；若尚未生成措施任务，则报告保留风险原因与通用治理建议。</p>
  {_render_table(["杆塔号", "当前风险", "建议后风险", "改造动作", "措施结论"], mitigation_table_rows or [["-", "-", "-", "当前未关联成功的措施推荐任务", "-"]])}

  <p class="muted">说明：本报告为可直接下载的 Word 兼容文档，内容按风险评估结果和已关联的措施推荐结果动态生成。</p>
</body>
</html>
"""

    return summary["document_filename"], html.encode("utf-8")


def _sanitize_filename(value: str) -> str:
    cleaned = "".join("-" if char in '<>:"/\\|?*' else char for char in value).strip()
    return cleaned[:80] or "防雷分析"


def _count_risk_levels(rows: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counts = {"high": 0, "medium": 0, "low": 0}
    for row in rows:
        risk_level = _normalize_risk_level(row.get("risk_level"))
        if risk_level in counts:
            counts[risk_level] += 1
    return counts


def _format_job_type(value: str | None) -> str:
    if value == "risk":
        return "风险评估任务"
    if value == "mitigation":
        return "措施推荐任务"
    return value or "-"


def _format_risk_level(value: Any) -> str:
    normalized = _normalize_risk_level(value)
    if normalized is None:
        return _display(value)
    return _RISK_LEVEL_LABELS[normalized]


def _normalize_risk_level(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text:
        return None
    if text in {"high", "高", "高风险"}:
        return "high"
    if text in {"medium", "中", "中风险"}:
        return "medium"
    if text in {"low", "低", "低风险"}:
        return "low"
    return None


def _join_action_summaries(result_json: Mapping[str, Any]) -> str:
    actions = []
    for action in _read_sequence(result_json, "mitigation_actions"):
        summary = str(action.get("summary") or action.get("label") or action.get("code") or "").strip()
        if summary:
            actions.append(summary)
    return "；".join(actions) if actions else "-"


def _split_cn_list(value: Any) -> list[str]:
    if value is None:
        return []
    text = str(value).replace("\n", "；")
    items = []
    for separator in ("；", ";", "、", ",", "，"):
        if separator in text:
            text = text.replace(separator, "；")
    for item in text.split("；"):
        cleaned = item.strip()
        if cleaned:
            items.append(cleaned)
    return items


def _render_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    header_html = "".join(f"<th>{escape(str(item))}</th>" for item in headers)
    body_html = "".join(
        "<tr>" + "".join(f"<td>{escape(str(cell))}</td>" for cell in row) + "</tr>"
        for row in rows
    )
    return f'<table class="data"><thead><tr>{header_html}</tr></thead><tbody>{body_html}</tbody></table>'


def _read_rows(payload: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _read_mapping(payload: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    value = payload.get(key)
    return value if isinstance(value, Mapping) else {}


def _read_sequence(payload: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _display(value: Any) -> str:
    if value is None:
        return "-"
    text = str(value).strip()
    return text or "-"


def _as_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None
