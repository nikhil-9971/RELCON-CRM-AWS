// Runtime config - injected by Docker entrypoint.
// Keep this relative in production so every API request uses the same origin
// as the frontend (nginx proxies /api to the backend container).
window.BACKEND_URL = "%%BACKEND_URL%%";
if (window.BACKEND_URL === "%%BACKEND_URL%%") {
  window.BACKEND_URL = "/api";
}
