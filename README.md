# Computable GPU 指数 (CGI) · 中文实时看板

[Computable GPU Index](https://github.com/getcomputable/gpu-index) (CGI) 的**非官方中文镜像站**:一个开源的 GPU 算力价格指数,单位 美元/GPU·时,覆盖 NVIDIA **H100 / H200 / B200 / B300** 四档按需算力。本站将原版实时看板 (`market.getcomputable.com/gpu-index`) 的内容完整中文化,部署于 GitHub Pages,全部静态、无后端、免密钥。

**🔗 在线地址:https://anyixuan798-wq.github.io/computable-gpu-index-zh/**

## 页面内容(与原版对应)

| 区块 | 说明 | 数据来源 |
|---|---|---|
| 主指数 Hero | 当前指数值、发布以来涨跌、稳定性带 ±、观测时间(UTC+北京时间)、新鲜度 | `data.getcomputable.com/latest.json`(官方公开 CDN,CORS 开放) |
| 车道切换 | H100 / H200 / B200 / B300 四档实时价格与 24H 变化,点击切换 | 同上,每 60 秒自动刷新 |
| 统计条 | 通过来源 n/n、今日最高/最低来源报价、发布以来涨跌 | 实时 receipts |
| 价格历史图 | 24H / 7D / 30D / 90D 视图,指数线 + ±稳定性带区间 + 今日指数虚线 | `data/snapshot.json`(本站快照) |
| 来源面板明细 | 8 家来源的报价、±波动带、活跃度权重、地区;报价分布带与指数参考位;行首可点开官方报价页 | 实时 receipts |
| 实时更新日志 | 各轮观测间来源报价的变动(▲▼ 差价),模拟原版 `tail receipts/*.log` | 快照内 `receipt_log` |
| 接入方式 | MCP 服务器地址、`git clone + ./reproduce` 复现命令(一键复制) | — |

## 数据管道

- **实时卡片**:浏览器直连官方 `https://data.getcomputable.com/latest.json`(公开、CORS `*`、60s 缓存),每 60 秒刷新一次,无需任何代理。
- **历史图表**:官方 REST API `api.getcomputable.com/v1/index/{SKU}/history` 对第三方站点做了 Origin 限制(浏览器跨域 403),因此本站用 **GitHub Actions 每 15 分钟**在服务器端抓取一次(匿名只读、无需密钥),生成 `data/snapshot.json`(含 90 天窗口内的原生 15 分钟粒度序列 + 来源报价变动日志),随页面一起部署。
- 快照对比基准为线上已部署的上一版(`gh-pages` 分支),从而能持续产出「来源报价变动日志」。

本地手动更新快照:

```bash
python tools/fetch_snapshot.py    # 仅标准库, 输出 data/snapshot.json
```

## 许可与版权

- 指数数据版权归 **Computable**,许可 **CC BY-NC 4.0**;署名见页脚:「Computable GPU Index by Computable — mcp.getcomputable.com」。
- 本站为社区制作的非官方中文镜像,与 Computable 无隶属关系,仅作学习与参考用途(非商业)。
- 本站代码 MIT(见下)。

## 本地运行

```bash
python -m http.server 8000     # 任意静态服务器即可, 浏览器打开 http://localhost:8000
```

> 注:历史图表依赖 `data/snapshot.json`(仓库内已含种子数据);Actions 每 15 分钟自动刷新后内容自动更新。若 fork 自部署,开启 GitHub Pages(Source: GitHub Actions)即可获得同样的自动刷新。
