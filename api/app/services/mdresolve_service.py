from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..schemas.mdresolve import (
    MdResolveImportRequest,
    MdResolveImportResponse,
    MdResolveOption,
    MdResolveParseRequest,
    MdResolveParseResponse,
    MdResolveQuestionDraft,
)
from ..schemas.question_bank import QuestionBankCreateRequest, QuestionBankSummary
from .push_service import publish_topic
from .question_bank_service import create_question

MDRESOLVE_TOPIC = "admin.question_bank"


@dataclass
class _ParseContext:
    default_question_type: str
    default_difficulty: str
    default_status: str
    warnings: list[str]


def parse_markdown_to_drafts(payload: MdResolveParseRequest) -> MdResolveParseResponse:
    lines = payload.markdown.splitlines()
    blocks = _split_blocks(lines)

    warnings: list[str] = []
    ctx = _ParseContext(
        default_question_type=payload.default_question_type,
        default_difficulty=payload.default_difficulty,
        default_status=payload.default_status,
        warnings=warnings,
    )

    items: list[MdResolveQuestionDraft] = []
    for index, block in enumerate(blocks, start=1):
        draft = _parse_block(block, index=index, ctx=ctx)
        if draft:
            items.append(draft)

    return MdResolveParseResponse(items=items, total=len(items), warnings=warnings)


def import_drafts_to_question_bank(
    db: Session,
    payload: MdResolveImportRequest,
    *,
    actor_user_id: str,
) -> MdResolveImportResponse:
    warnings: list[str] = []
    created: list[QuestionBankSummary] = []

    for index, item in enumerate(payload.items, start=1):
        tags = _normalize_tags(item.tags_json)
        create_payload = QuestionBankCreateRequest(
            question_type=item.question_type,
            stem=item.stem.strip(),
            options_json=[opt.model_dump() for opt in item.options_json] if item.options_json else None,
            answer=item.answer.strip(),
            analysis=(item.analysis or "").strip() or None,
            difficulty=item.difficulty,
            status=item.status,
            tags_json=tags,
        )

        try:
            saved = create_question(db, create_payload, actor_user_id=actor_user_id)
            created.append(saved)
        except Exception as ex:
            warnings.append(f"第 {index} 条导入失败：{ex}")

    if created:
        _fire_and_forget(
            publish_topic(
                MDRESOLVE_TOPIC,
                name="mdresolve.imported",
                payload={"action": "batch_import", "created_count": len(created)},
                requires_refetch=["/api/v1/admin/question-bank"],
                dedupe_key=f"mdresolve:import:{actor_user_id}:{len(created)}",
            )
        )

    return MdResolveImportResponse(created_count=len(created), items=created, warnings=warnings)


def _split_blocks(lines: list[str]) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []

    def flush() -> None:
        nonlocal current
        if current:
            blocks.append(current)
            current = []

    for raw in lines:
        line = raw.rstrip()
        if re.match(r"^\s*(#+\s*)?(第?\s*\d+\s*[、.．）)]\s*)?题\b", line):
            flush()
            current = [line]
            continue

        if re.match(r"^\s*(\d+[、.．）)])\s+", line) and current:
            flush()
            current = [line]
            continue

        if not current and not line.strip():
            continue

        current.append(line)

    flush()
    return blocks


def _parse_block(block: list[str], *, index: int, ctx: _ParseContext) -> MdResolveQuestionDraft | None:
    text_lines = [line.strip() for line in block if line.strip()]
    if not text_lines:
        return None

    stem = ""
    answer = ""
    analysis = ""
    options: list[MdResolveOption] = []
    tags: list[str] = []
    question_type = ctx.default_question_type
    difficulty = ctx.default_difficulty
    status = ctx.default_status

    option_started = False

    for i, line in enumerate(text_lines):
        key, value = _split_kv(line)

        if key in {"题干", "问题", "题目", "stem", "question"}:
            stem = value
            continue

        if key in {"答案", "answer", "正确答案"}:
            answer = value
            continue

        if key in {"解析", "analysis", "说明"}:
            analysis = value
            continue

        if key in {"标签", "tags", "tag"}:
            tags = _normalize_tags(re.split(r"[,，;；\s]+", value))
            continue

        if key in {"难度", "difficulty"}:
            difficulty = _normalize_difficulty(value, default=ctx.default_difficulty)
            continue

        if key in {"状态", "status"}:
            status = _normalize_status(value, default=ctx.default_status)
            continue

        if key in {"题型", "type", "question_type"}:
            question_type = _normalize_question_type(value, default=ctx.default_question_type)
            continue

        option = _parse_option_line(line)
        if option:
            options.append(option)
            option_started = True
            continue

        if not stem:
            stem = _strip_question_prefix(line)
            continue

        if option_started and not answer and i == len(text_lines) - 1:
            # 常见格式：最后一行直接写答案字母
            normalized = _normalize_answer_token(line)
            if normalized:
                answer = normalized
                continue

        if analysis:
            analysis = f"{analysis}\n{line}" if analysis else line

    if not stem:
        ctx.warnings.append(f"第 {index} 题缺少题干，已跳过")
        return None

    if not answer:
        inferred = _infer_answer_from_stem(stem)
        if inferred:
            answer = inferred
        else:
            ctx.warnings.append(f"第 {index} 题缺少答案，已跳过")
            return None

    if question_type in {"single_choice", "multiple_choice"} and not options:
        ctx.warnings.append(f"第 {index} 题未解析到选项，已降级为简答题")
        question_type = "short_answer"

    return MdResolveQuestionDraft(
        question_type=question_type,
        stem=stem,
        options_json=options or None,
        answer=answer,
        analysis=analysis or None,
        difficulty=difficulty,
        status=status,
        tags_json=tags,
    )


def _split_kv(line: str) -> tuple[str, str]:
    for sep in [":", "："]:
        if sep in line:
            left, right = line.split(sep, 1)
            key = left.strip().lower()
            return key, right.strip()
    return "", line.strip()


def _parse_option_line(line: str) -> MdResolveOption | None:
    m = re.match(r"^\s*([A-Ha-h])[\.、:：\)]\s*(.+)$", line)
    if m:
        return MdResolveOption(key=m.group(1).upper(), content=m.group(2).strip())

    m2 = re.match(r"^\s*[-*]\s*([A-Ha-h])\s*[\.、:：\)]\s*(.+)$", line)
    if m2:
        return MdResolveOption(key=m2.group(1).upper(), content=m2.group(2).strip())

    return None


def _strip_question_prefix(line: str) -> str:
    line = re.sub(r"^\s*(#+\s*)?", "", line)
    line = re.sub(r"^\s*(第?\s*\d+\s*[、.．）)])\s*", "", line)
    line = re.sub(r"^\s*题\s*[:：]?\s*", "", line)
    return line.strip()


def _normalize_answer_token(raw: str) -> str:
    value = raw.strip().upper()
    value = value.replace("答案", "").replace(":", "").replace("：", "").strip()
    if re.fullmatch(r"[A-H](\s*[,，/\s]\s*[A-H]){0,7}", value):
        values = re.split(r"[,，/\s]+", value)
        values = [v for v in values if v]
        return ",".join(values)
    return ""


def _infer_answer_from_stem(stem: str) -> str:
    match = re.search(r"（?答案[:：]\s*([A-Ha-h](?:\s*[,，/\s]\s*[A-Ha-h])*)", stem)
    if not match:
        return ""
    return _normalize_answer_token(match.group(1))


def _normalize_question_type(raw: str, *, default: str) -> str:
    value = raw.strip().lower()
    mapping = {
        "单选": "single_choice",
        "单选题": "single_choice",
        "single": "single_choice",
        "single_choice": "single_choice",
        "多选": "multiple_choice",
        "多选题": "multiple_choice",
        "multiple": "multiple_choice",
        "multiple_choice": "multiple_choice",
        "判断": "true_false",
        "判断题": "true_false",
        "true_false": "true_false",
        "简答": "short_answer",
        "简答题": "short_answer",
        "short_answer": "short_answer",
    }
    return mapping.get(value, default)


def _normalize_difficulty(raw: str, *, default: str) -> str:
    value = raw.strip().lower()
    mapping = {
        "easy": "easy",
        "简单": "easy",
        "medium": "medium",
        "中": "medium",
        "中等": "medium",
        "hard": "hard",
        "困难": "hard",
        "难": "hard",
    }
    return mapping.get(value, default)


def _normalize_status(raw: str, *, default: str) -> str:
    value = raw.strip().lower()
    mapping = {
        "draft": "draft",
        "草稿": "draft",
        "published": "published",
        "发布": "published",
        "已发布": "published",
        "archived": "archived",
        "归档": "archived",
        "已归档": "archived",
    }
    return mapping.get(value, default)


def _normalize_tags(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    dedup: list[str] = []
    seen = set()
    for tag in tags:
        value = str(tag).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        dedup.append(value)
    return dedup


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
