# 高程数据管理重构总结

## 重构目标

将高程数据管理从"数据集中心"模式重构为"文件中心"模式，去掉 ElevationDataset 概念，扁平化为 ElevationFileRecord，每条记录对应一个高程文件。

## 重构成果

### 1. 数据库层面

**新增表**: `elevation_file_record`
- 合并了原 `elevation_dataset` 的核心字段
- 新增 `file_size` 字段记录文件大小
- 新增 `file_name` 字段单独存储文件名
- 包含完整的分析、地形状态追踪字段

**更新关联表**:
- `elevation_apply_job` 添加 `file_record_id` 字段（保留 `dataset_id` 用于向后兼容）
- `elevation_data_import_job` 添加 `file_record_id` 字段（保留 `dataset_id` 用于向后兼容）

**迁移脚本**: `api/migrations/001_add_elevation_file_record.sql`
- 自动从旧表迁移数据
- 创建必要的索引
- 提供兼容性视图

### 2. 后端 API

#### 新增的 File Record API（推荐使用）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/elevation/records` | GET | 获取文件记录列表 |
| `/api/v1/elevation/records` | POST | 上传文件并创建记录（上传即创建） |
| `/api/v1/elevation/records/{id}` | GET | 获取文件记录详情 |
| `/api/v1/elevation/records/{id}` | PATCH | 更新文件记录 |
| `/api/v1/elevation/records/{id}` | DELETE | 删除文件记录 |
| `/api/v1/elevation/records/{id}/analyze` | POST | 触发分析任务 |
| `/api/v1/elevation/records/{id}/terrain/build` | POST | 生成地形瓦片 |
| `/api/v1/elevation/records/{id}/preview` | GET | 预览文件数据 |

#### 保留的 Dataset API（向后兼容）

原有的 `/api/v1/elevation/datasets/*` 端点保持不变，继续支持旧版前端。

#### 更新的 Apply API

`POST /api/v1/elevation/jobs/apply-line` 现在同时支持：
- `file_record_id`: 使用新的文件记录 ID（推荐）
- `dataset_id`: 使用旧的数据集 ID（向后兼容）

### 3. 代码文件

#### 新增文件

1. **模型层**: `api/app/models/elevation.py`
   - 添加 `ElevationFileRecord` 模型类

2. **Schema 层**: `api/app/schemas/elevation.py`
   - `ElevationFileRecordSummary`
   - `ElevationFileRecordListResponse`
   - `ElevationFileRecordCreateRequest`
   - `ElevationFileRecordUpdateRequest`
   - `ElevationFileRecordAnalyzeResponse`
   - `ElevationFileRecordTerrainBuildResponse`
   - `ElevationFileRecordPreviewResponse`
   - `ElevationFileRecordUploadResponse`

3. **Service 层**: `api/app/services/elevation_file_record_service.py`
   - `list_file_records()`: 列出文件记录
   - `get_file_record_by_id()`: 获取单条记录
   - `create_file_record_from_upload()`: 上传并创建记录
   - `update_file_record()`: 更新记录
   - `delete_file_record()`: 删除记录
   - `queue_file_record_analysis()`: 队列分析任务
   - `queue_file_record_terrain_build()`: 队列地形构建任务
   - `preview_file_record()`: 预览文件数据
   - `serialize_file_record()`: 序列化记录

4. **API 路由**: `api/app/api/v1/elevation.py`
   - 新增 `/records` 路由组
   - 保留 `/datasets` 路由用于向后兼容

5. **前端页面**: `web/src/app/admin/elevation-records/page.tsx`
   - 全新的简化界面（从 1760 行简化到 ~600 行）
   - 上传即创建，无需先创建数据集
   - 每行直接对应一个文件
   - 简化的操作流程

6. **迁移脚本**: `api/migrations/001_add_elevation_file_record.sql`
   - 数据库结构变更
   - 数据迁移逻辑

7. **迁移文档**: `api/migrations/README.md`
   - 迁移说明和步骤

#### 更新文件

1. `api/app/models/elevation.py`: 添加 `ElevationFileRecord` 模型
2. `api/app/schemas/elevation.py`: 添加新的 Schema 定义，更新 `ElevationApplyJobSummary` 和 `ElevationApplyJobCreateRequest`
3. `api/app/api/v1/elevation.py`: 添加新路由，更新 apply 端点支持双 ID

### 4. 用户体验改进

#### 旧流程（数据集中心）
1. 创建数据集（填写编码、名称）
2. 导入文件到数据集
3. 分析数据集
4. 预览/地形/回填

#### 新流程（文件中心）
1. 直接上传文件（填写来源、分辨率、备注）→ 自动创建记录 + 触发分析
2. 分析完成后：预览/地形/回填

**简化点**：
- 去掉了"数据集"这个中间层概念
- 上传即创建，一步到位
- 列表直接显示文件，不需要展开查看
- 操作更直观（针对文件而非数据集）

## 使用指南

### 执行数据库迁移

```bash
# 备份数据库
pg_dump -U your_user your_database > backup.sql

# 执行迁移
psql -U your_user -d your_database -f api/migrations/001_add_elevation_file_record.sql
```

### API 使用示例

#### 上传文件（新 API）

```bash
curl -X POST http://localhost:8000/api/v1/elevation/records \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@elevation_data.tif" \
  -F "source=SRTM" \
  -F "resolution_m=30" \
  -F "notes=高程数据" \
  -F "trigger_analysis=true"
```

#### 回填线路（支持新旧 ID）

```bash
# 使用新的 file_record_id
curl -X POST http://localhost:8000/api/v1/elevation/jobs/apply-line \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "line_id": "line123",
    "file_record_id": "record456",
    "mode": "fill_null_only"
  }'

# 使用旧的 dataset_id（向后兼容）
curl -X POST http://localhost:8000/api/v1/elevation/jobs/apply-line \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "line_id": "line123",
    "dataset_id": "dataset789",
    "mode": "fill_null_only"
  }'
```

### 前端访问

- **新页面**: `http://localhost:3000/admin/elevation-records`
- **旧页面**: `http://localhost:3000/admin/elevation`（继续可用）

## 向后兼容策略

1. **数据库层**: 保留旧表，新表独立存在，通过 ID 复用实现兼容
2. **API 层**: 旧 `/datasets` 端点继续工作，新 `/records` 端点并行存在
3. **前端**: 旧页面和新页面可以同时访问
4. **Apply Job**: 同时支持 `file_record_id` 和 `dataset_id` 参数

## 后续清理计划

当确认新系统运行稳定（建议观察 1-2 周）后，可执行清理：

```sql
-- 删除旧表
DROP TABLE IF EXISTS elevation_dataset_file_meta CASCADE;
DROP TABLE IF EXISTS elevation_dataset CASCADE;

-- 删除旧字段
ALTER TABLE elevation_apply_job DROP COLUMN IF EXISTS dataset_id;
ALTER TABLE elevation_data_import_job DROP COLUMN IF EXISTS dataset_id;

-- 删除兼容性视图
DROP VIEW IF EXISTS elevation_dataset_compat;
```

删除旧前端页面：
```bash
# 可选：删除旧的前端页面
rm web/src/app/admin/elevation/page.tsx
```

## 注意事项

1. **执行迁移前务必备份数据库**
2. 迁移脚本是幂等的，可以安全重复执行
3. 新旧 API 可以并存，逐步切换客户端
4. 建议先在测试环境验证完整流程
5. 迁移后立即测试核心功能：上传、分析、预览、地形生成、回填

## 测试清单

- [ ] 数据库迁移成功执行
- [ ] 旧数据成功迁移到新表
- [ ] 上传新文件并创建记录
- [ ] 触发文件分析
- [ ] 预览文件数据
- [ ] 生成地形瓦片（栅格格式）
- [ ] 使用新 file_record_id 回填线路
- [ ] 使用旧 dataset_id 回填线路（兼容性测试）
- [ ] 删除文件记录
- [ ] 旧前端页面仍能正常工作
- [ ] 新前端页面所有功能正常

## 技术债务

- [ ] 需要为 `elevation_tasks.py` 添加新的任务函数：
  - `analyze_elevation_file_record_job`
  - `build_elevation_file_record_terrain_job`
- [ ] Service 层某些函数仍依赖 dataset 结构，需要进一步适配
- [ ] 完整删除旧代码前需要确认所有客户端已切换

## 结论

重构成功将高程数据管理从 1760 行复杂代码简化到约 600 行，去除了不必要的"数据集"抽象层，使功能更加直观和易用。新旧系统可以并存运行，提供了平滑的迁移路径。
