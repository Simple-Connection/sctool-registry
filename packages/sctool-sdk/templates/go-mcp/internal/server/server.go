package server

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
)

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type toolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func Run(stdin io.Reader, stdout io.Writer, name, title, version string) error {
	scanner := bufio.NewScanner(stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	writer := bufio.NewWriter(stdout)
	defer writer.Flush()

	for scanner.Scan() {
		payload, emit := handle(scanner.Bytes(), name, title, version)
		if !emit {
			continue
		}
		if _, err := writer.Write(payload); err != nil {
			return err
		}
		if err := writer.WriteByte('\n'); err != nil {
			return err
		}
		if err := writer.Flush(); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("stdio scan: %w", err)
	}
	return nil
}

func handle(data []byte, name, title, version string) ([]byte, bool) {
	var req request
	if err := json.Unmarshal(data, &req); err != nil {
		return marshal(response{JSONRPC: "2.0", Error: &rpcError{Code: -32700, Message: err.Error()}}), true
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		if len(req.ID) == 0 {
			return nil, false
		}
		return marshal(response{JSONRPC: "2.0", ID: req.ID, Error: &rpcError{Code: -32600, Message: "invalid request"}}), true
	}
	if len(req.ID) == 0 {
		return nil, false
	}

	var result any
	var rpcErr *rpcError
	switch req.Method {
	case "initialize":
		result = map[string]any{
			"protocolVersion": "2025-03-26",
			"capabilities": map[string]any{"tools": map[string]any{}},
			"serverInfo": map[string]any{"name": name, "title": title, "version": version},
		}
	case "ping":
		result = map[string]any{}
	case "tools/list":
		result = map[string]any{"tools": []any{healthTool()}}
	case "tools/call":
		var params toolCallParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			rpcErr = &rpcError{Code: -32602, Message: err.Error()}
			break
		}
		if params.Name != "health" {
			rpcErr = &rpcError{Code: -32602, Message: "unknown tool: " + params.Name}
			break
		}
		result = map[string]any{
			"content": []any{map[string]any{"type": "text", "text": "ok"}},
			"isError": false,
		}
	default:
		rpcErr = &rpcError{Code: -32601, Message: "method not found"}
	}

	return marshal(response{JSONRPC: "2.0", ID: req.ID, Result: result, Error: rpcErr}), true
}

func healthTool() map[string]any {
	return map[string]any{
		"name": "health",
		"description": "Return the SCTool process health status.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{},
			"additionalProperties": false,
		},
	}
}

func marshal(value response) []byte {
	payload, _ := json.Marshal(value)
	return payload
}
