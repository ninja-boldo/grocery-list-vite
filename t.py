import http.client

conn = http.client.HTTPSConnection("chat.kiconnect.nrw")

payload = '{"messages":[{"role":"","content":null,"name":null,"tool_call_id":null,"tool_calls":[{"id":null,"type":null,"function":{"name":null,"arguments":null}}]}],"model":null,"frequency_penalty":null,"logit_bias":null,"logprobs":null,"max_completion_tokens":null,"presence_penalty":null,"seed":null,"stop":[""],"temperature":null,"top_logprobs":null,"top_p":null,"tool_choice":{"mode":null,"type":null,"functionName":null},"tools":[{"type":"","function":{"name":"","description":null,"parameters":null,"strict":null}}],"parallel_tool_calls":null,"response_format":{"type":"","json_schema":{"name":"","description":null,"schema":null,"strict":null}},"stream":null,"stream_options":{"include_usage":null},"metadata":null,"prediction":{"type":null,"content":null},"reasoning_effort":null}'

headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_SECRET_TOKEN",
}

conn.request("POST", "/api/v1/chat/completions", payload, headers)

res = conn.getresponse()
data = res.read()

print(data.decode("utf-8"))
