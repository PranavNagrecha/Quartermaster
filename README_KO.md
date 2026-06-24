<div align="center">

# 🧭 Quartermaster

**에이전트에게 임무에 필요한 도구만 정확히 지급합니다.**

MCP를 위한 오프라인·무의존성 도구 라우터. 자연어 질의에 대해 *N*개의 도구를
순위가 매겨진 후보 목록으로 좁혀, 모델이 200개 대신 ~8개만 읽도록 합니다.
임베딩 모델·네트워크·API 키가 필요 없습니다.

[빠른 시작](docs/quickstart.md) · [작동 방식](docs/how-it-works.md) · [벤치마크](docs/benchmarks.md) · [English](README.md) · [한국어](README_KO.md)

</div>

---

> **상태: 초기/알파.** 코어 랭커는 동작하며 프로덕션 시스템에서 추출되었습니다.
> 프록시와 Claude Code 플러그인은 스캐폴드 상태입니다.

## 문제

모델에 도구 200개를 주면 두 가지가 망가집니다. 매 턴마다 모든 스키마가
컨텍스트에 실리고(토큰 비용), 비슷한 200개 중에서 올바른 하나를 골라야 합니다
(개수가 늘수록 정확도 하락). 이는 잘 알려진 선행 연구입니다 —
[RAG-MCP](https://arxiv.org/abs/2505.03275), [ToolRet (ACL 2025)](https://arxiv.org/abs/2503.01763).

## 구조: 깔때기는 조언하고, 모델이 결정합니다

Quartermaster는 결정하지 않습니다. 순위가 매겨진 후보 목록을 돌려주고,
이미 루프 안에 있는 호스트 LLM이 최종 선택을 합니다. 따라서 top-1이 아니라
**recall@K**(올바른 도구가 상위 K개 안에 있는가)를 최적화합니다.

## 무엇이 다른가

- **임베딩 모델 없음** — torch도, 모델 다운로드도 없습니다.
- **호스트 독립적** — Anthropic API 밖에서도, 어떤 MCP 클라이언트/모델에서도.
- **조언하되 결정하지 않음** — 후보 목록 + 가이드를 반환.
- **오프라인·프라이버시** — 외부로 아무것도 전송하지 않음.

최고 수준의 검색 정확도를 주장하지 않습니다. 순수 어휘 기반 랭킹은 대규모에서
하이브리드 임베딩에 뒤처집니다. 우리의 가설: **무의존성 하이브리드**(BM25 +
오프라인 질의 확장)가 그 격차를 충분히 메워 "모델 없는 기본값"이 될 수 있는가 —
[벤치마크](docs/benchmarks.md)에서 공개적으로 검증합니다.

## 빠른 시작

Quartermaster는 단일 패키지 `quartermaster-mcp` 하나입니다. 여러 MCP 서버 앞에
두면, 클라이언트는 모든 다운스트림 스키마 대신 `retrieve_tools` + `call_tool`
두 개만 로드합니다. `quartermaster.json`을 가리키세요:

```json
{
  "servers": [
    { "id": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" } }
  ]
}
```

```bash
npx quartermaster-mcp --config ./quartermaster.json
```

순위 랭커(BM25 + 오프라인 확장)는 프록시에 **번들로 포함**되어 별도로 설치할
필요가 없습니다. 자세한 내용은 [Cursor 레시피](docs/recipes/cursor.md)를 참고하세요.

## 라이선스

MIT © 2026 Pranav Nagrecha
