// ✅ Logger SABSE PEHLE — taaki sab console calls capture ho
require('./utils/logger');  

require("dotenv").config();
const express    = require("express");
const bodyParser = require("body-parser");
const cors       = require("cors");
const http       = require("http");
const path       = require("path");
const connectDB  = require("./config/db");

const { router: authRoutes }  = require("./routes/auth");
const planRoutes               = require("./routes/plans");
const roRoutes                 = require("./routes/romaster");
const statusRoutes             = require("./routes/statusmodel");
const atgstatusRoutes          = require("./routes/atgStatusRoutes");
const auditRoutes              = require("./routes/audit");
const taskRoutes               = require("./routes/taskRoutes");
const jioBPStatusRoutes        = require("./routes/jioBPStatusRoutes");
const bpclStatusRoutes         = require("./routes/bpclStatusRoutes");
const materialRoutes           = require("./routes/materialRequirement");
const materialManagement       = require("./routes/materialManagement")
const chatRoutes               = require("./routes/chatRoutes");
const incidentRoutes           = require("./routes/incidentRoutes");
const aiAgentRoutes            = require("./routes/aiAgent");
const errorLogRoutes           = require('./routes/errorLogs');
const { serverLogsRouter }     = require('./routes/serverLogs');  // ✅ NEW
const { httpLogger }           = require('./utils/logger');       // ✅ NEW
const { setupWebsocket, broadcastToAll } = require("./chat_ws");
const { startCronJobs }        = require("./routes/corn");
const attendance = require("./routes/attendanceRoutes");

// ✅ STEP 1: app create (IMPORTANT)
const app = express();

// ✅ STEP 2: server create
const server = http.createServer(app);

// ✅ MongoDB connect
connectDB();

// ✅ attach websocket
setupWebsocket(server);

// ✅ CORS
const allowedOrigins = [
  "https://nikhildevops.co.in",
  "https://www.nikhildevops.co.in",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  process.env.FRONTEND_URL,

];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.netlify.app') || origin.endsWith('.onrender.com')) {
      callback(null, true);
    } else {
      console.warn('[CORS] Blocked origin:', origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

// ✅ Body parsers
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set("trust proxy", true);
app.use(require("express").static("public"));

// ✅ HTTP Request Logger — log every API call
app.use(httpLogger);

// ✅ Routes
app.get("/", (req, res) => res.send("✅ RELCON Backend is running"));

app.use("/api", authRoutes);
app.use("/api/romaster", roRoutes);
app.use("/api", planRoutes);
app.use("/api", statusRoutes);
app.use("/api", atgstatusRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/audit", errorLogRoutes);    // Frontend error logs
app.use("/api/audit", serverLogsRouter);  // ✅ Server/container logs
app.use("/api", taskRoutes);
app.use("/api/jioBP", jioBPStatusRoutes);
app.use("/api/bpclStatus", bpclStatusRoutes);
app.use("/api/materialRequirement", materialRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api", incidentRoutes);
app.use("/api/ai", aiAgentRoutes);
app.use("/api/materialManagement", materialManagement);
app.use("/api/attendance", attendance);



startCronJobs(broadcastToAll);
require("./services/mailer");

// ✅ Dashboard — /dashboard pe refresh karne pe bhi kaam kare
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ✅ Login page clean URL
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ✅ Block direct .html file access — URL se koi bhi .html directly open na ho
app.use((req, res, next) => {
  if (req.path.endsWith(".html")) {
    return res.status(403).json({ error: "Direct file access not allowed" });
  }
  next();
});

app.use((req, res) => res.status(404).send("Page not found"));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server + WebSocket running on port ${PORT}`);
});
