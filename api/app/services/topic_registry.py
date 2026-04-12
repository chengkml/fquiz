from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TopicRule:
    any_permission_codes: set[str] = field(default_factory=set)
    allow_any_authenticated_user: bool = False
    auto_subscribe: bool = False
    client_subscribable: bool = True


AUTO_TOPICS = {"system", "auth", "notifications"}

TOPIC_RULES: dict[str, TopicRule] = {
    "system": TopicRule(allow_any_authenticated_user=True, auto_subscribe=True),
    "auth": TopicRule(allow_any_authenticated_user=True, auto_subscribe=True),
    "notifications": TopicRule(allow_any_authenticated_user=True, auto_subscribe=True),
    "admin.dashboard": TopicRule(allow_any_authenticated_user=True),
    "admin.users": TopicRule(any_permission_codes={"user.manage"}),
    "admin.roles": TopicRule(any_permission_codes={"role.read", "role.manage"}),
    "admin.menus": TopicRule(any_permission_codes={"menu.read", "menu.manage"}),
    "admin.files": TopicRule(any_permission_codes={"file.read", "file.manage"}),
    "requirements": TopicRule(any_permission_codes={"requirement.read", "requirement.process", "requirement.manage"}),
}


def get_auto_topics() -> set[str]:
    return {topic for topic, rule in TOPIC_RULES.items() if rule.auto_subscribe}


def is_builtin_topic(topic: str) -> bool:
    return topic in AUTO_TOPICS


def validate_topic_subscription(
    topic: str,
    *,
    role_codes: set[str],
    permission_codes: set[str],
) -> tuple[bool, str | None]:
    if "admin" in role_codes:
        return True, None

    rule = TOPIC_RULES.get(topic)
    if not rule:
        return False, "unknown_topic"
    if not rule.client_subscribable:
        return False, "topic_not_subscribable"
    if rule.allow_any_authenticated_user:
        return True, None
    if rule.any_permission_codes and permission_codes.intersection(rule.any_permission_codes):
        return True, None
    return False, "missing_permission"
