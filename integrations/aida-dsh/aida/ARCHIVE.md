# 原始 AIDA 项目资料

本目录完整归档自 `C:\Users\yangjing\Project\dsh-\aida`，保留以下作者维护的内容：

- `docs/`：改动记录、分支说明、插件标准核对、HTML 演示和设计资源。
- `docs/assets/`：SVG 与可继续编辑的 Excalidraw 架构图。
- `plugins/aida-desktop/PRD.md`：AIDA Desktop PRD。
- `plugins/aida-w3/PRD.md`：AIDA W3 PRD。
- `slides/SLIDES.md`：AIDA 演示提纲。

`.excalidraw-export/` 和 `node_modules/` 是原目录 `.gitignore` 排除的本机生成内容，因此没有归档。它们不是插件源码；需要时可以从已保存的 Excalidraw 文件重新生成。

可安装 DSH 插件的实现源码不在此资料目录中，而在上一级的 [`src/`](../src/)；对应的 package manifest、Cordis 安装层、测试和构建配置也都位于上一级。可直接安装的构建位于 [`releases/`](../releases/)。
