# 使用桌面应用

[English](index.md) | 中文

打开已安装的 Merforge 桌面应用。新安装尚未选中工作区，需要先添加一个。

## 配置模型

打开**设置 → 模型**，输入 [DeepSeek API 密钥](https://platform.deepseek.com/)并保存。模型路由会立即可用。

[模型配置指南](./providers.zh.md)介绍其他提供方和自定义 OpenAI 兼容端点。

## 选择工作区

点击**选择工作区**，添加项目目录并选中。选中工作区前，会话输入框不可用。

## 运行任务

启动一个会话并发送：

> Summarize this repository and identify its main packages.

Agent（智能体）可以读取和编辑工作区文件、运行命令、委派工作并维护计划。如果根据当前权限策略，某项操作需要审批，桌面 UI 会先询问你。

## 继续使用

- [配置模型](./providers.zh.md)
- [开发插件](../develop/basic/index.zh.md)
