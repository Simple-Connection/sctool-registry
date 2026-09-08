# __DISPLAY_NAME__

Simple Connection에서 `stdio` MCP 서버로 실행되는 Go 기반 SCTool입니다.

## Entry

- Package ID: `__PACKAGE_ID__`
- Command: `bin/win-x64/__COMMAND_NAME__.exe`
- Transport: `stdio`

## Tools

- `health`: 실행 프로세스의 기본 상태를 반환합니다.

## Environment

이 초기 템플릿은 사용자 설정 환경변수를 선언하지 않습니다. 필요한 변수가 생기면 `packaging/tool.template.json`의 `environment.variables` 배열에 SCTool SDK v1의 7개 필드 계약으로 추가합니다.
