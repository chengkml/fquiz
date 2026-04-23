from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class MermaidRequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class MermaidGroupSummary(BaseModel):
    id: str
    name: str
    label: str
    type: str | None = None
    descr: str | None = None


class MermaidGroupListResponse(BaseModel):
    items: list[MermaidGroupSummary]
    total: int


class MermaidDiagramSummary(BaseModel):
    id: str
    diagram_name: str
    description: str | None = None
    diagram_data: str | None = None
    group_name: str | None = None
    group_label: str | None = None
    tag_names: list[str] = Field(default_factory=list)
    tag_labels: list[str] = Field(default_factory=list)
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class MermaidDiagramPageResponse(BaseModel):
    items: list[MermaidDiagramSummary]
    total: int
    page_num: int
    page_size: int


class MermaidDiagramQueryRequest(MermaidRequestModel):
    key_word: str | None = Field(default=None, max_length=255, validation_alias=AliasChoices("key_word", "keyWord"))
    group: str | None = Field(default=None, max_length=128)
    tags: list[str] | None = None
    page_num: int = Field(default=0, ge=0, validation_alias=AliasChoices("page_num", "pageNum"))
    page_size: int = Field(default=20, ge=1, le=500, validation_alias=AliasChoices("page_size", "pageSize"))


class MermaidDiagramCreateRequest(MermaidRequestModel):
    diagram_name: str = Field(min_length=1, max_length=255, validation_alias=AliasChoices("diagram_name", "diagramName"))
    description: str | None = Field(default="", max_length=20000)
    diagram_data: str | None = Field(default="", max_length=200000, validation_alias=AliasChoices("diagram_data", "diagramData"))
    group: str | None = Field(default=None, max_length=128)
    tags: list[str] = Field(default_factory=list)


class MermaidDiagramUpdateRequest(MermaidRequestModel):
    id: str = Field(min_length=1, max_length=32)
    diagram_name: str | None = Field(default=None, min_length=1, max_length=255, validation_alias=AliasChoices("diagram_name", "diagramName"))
    description: str | None = Field(default=None, max_length=20000)
    diagram_data: str | None = Field(default=None, max_length=200000, validation_alias=AliasChoices("diagram_data", "diagramData"))
    group: str | None = Field(default=None, max_length=128)
    tags: list[str] | None = None


class MermaidDiagramDataPatchRequest(MermaidRequestModel):
    diagram_data: str = Field(min_length=1, max_length=200000, validation_alias=AliasChoices("diagram_data", "diagramData"))


class MermaidChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20000)


class MermaidChatStreamRequest(MermaidRequestModel):
    model_name: str | None = Field(default=None, max_length=128, validation_alias=AliasChoices("model_name", "modelName"))
    diagram_data: str | None = Field(default=None, max_length=200000, validation_alias=AliasChoices("diagram_data", "diagramData"))
    messages: list[MermaidChatMessage] = Field(default_factory=list)
