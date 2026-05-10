# EXiF-renamer

照片 EXIF 重命名工具 - 基于 Tauri + Rust 实现

## 功能特性

- 📸 **EXIF 数据读取** - 支持 JPG 和 RAW 文件格式（包括 Sony RAW）
- 🔄 **智能重命名** - 根据拍摄时间自动重命名照片
- 👁️ **图片预览** - 快速预览 JPG 和 RAW 文件缩略图
- 📋 **批量处理** - 支持多文件同时处理
- ⚠️ **重复检测** - 自动检测并处理重复文件名
- 🗑️ **单文件删除** - 便捷的单个文件删除功能
- 📊 **可调整布局** - 列表与预览面板宽度可自由调整
- 🎨 **美观界面** - 现代化 UI 设计，支持深色主题

## 技术栈

- **前端**: HTML5 + CSS3 + JavaScript
- **后端**: Rust
- **框架**: Tauri v2
- **EXIF 解析**: kamadak-exif
- **RAW 处理**: rawloader

## 支持的文件格式

- JPEG / JPG
- Sony RAW (ARW, SR2)
- 其他常见 RAW 格式

## 安装与运行

### 前置要求

- Rust 1.70+
- Node.js 18+
- npm 或 yarn

### 开发模式

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run tauri dev
```

### 构建生产版本

```bash
npm run tauri build
```

## 使用说明

1. **添加照片** - 点击「添加照片」按钮或拖拽文件到窗口
2. **预览照片** - 点击列表中的文件在右侧预览
3. **查看 EXIF** - 悬停在文件名上查看相机型号和镜头信息
4. **重命名** - 点击「重命名」按钮批量处理
5. **删除文件** - 点击列表中的删除按钮移除单个文件
6. **调整布局** - 拖动分隔条调整列表和预览面板宽度

## 重命名规则

默认格式: `YYYY-MM-DD_HH-MM-SS.ext`

示例:
- `DSC0001.ARW` → `2024-05-10_14-30-22.arw`
- `IMG_1234.JPG` → `2024-05-10_14-30-22.jpg`

如果检测到重复文件名，会自动添加序号:
- `2024-05-10_14-30-22.jpg`
- `2024-05-10_14-30-22_1.jpg`
- `2024-05-10_14-30-22_2.jpg`

## 项目结构

```
exif-renamer/
├── src/                    # 前端代码
│   ├── main.js            # 主应用逻辑
│   └── styles.css         # 样式文件
├── src-tauri/             # Rust 后端
│   ├── src/
│   │   ├── commands.rs    # Tauri 命令处理
│   │   ├── exif.rs        # EXIF 读取和预览生成
│   │   ├── models.rs      # 数据模型
│   │   ├── lib.rs
│   │   └── main.rs        # 入口文件
│   ├── Cargo.toml         # Rust 依赖
│   └── tauri.conf.json    # Tauri 配置
├── index.html             # HTML 入口
├── package.json           # Node 依赖
└── vite.config.js         # Vite 配置
```

## 许可证

MIT License
