// ✅ Logger SABSE PEHLE — taaki sab console calls capture ho
require('./utils/logger');  

require("dotenv").config();
const express    = require("express");
const bodyParser = require("body-parser");
const cors       = require("cors");
const http       = require("http");
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

const app = express();

// ✅ MongoDB connect
connectDB();

// ✅ CORS
const allowedOrigins = [
  "https://relconecz1.netlify.app",
  "https://relcon-crm-frontend.onrender.com",  // ✅ Render frontend
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  null,
  "null",
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

app.use("/", authRoutes);
app.use("/romaster", roRoutes);
app.use("/", planRoutes);
app.use("/", statusRoutes);
app.use("/", atgstatusRoutes);
app.use("/audit", auditRoutes);
app.use("/audit", errorLogRoutes);    // Frontend error logs
app.use("/audit", serverLogsRouter);  // ✅ Server/container logs
app.use("/", taskRoutes);
app.use("/jioBP", jioBPStatusRoutes);
app.use("/bpclStatus", bpclStatusRoutes);
app.use("/materialRequirement", materialRoutes);
app.use("/chat", chatRoutes);
app.use("/", incidentRoutes);
app.use("/ai", aiAgentRoutes);
app.use("/materialManagement", materialManagement)

const server = http.createServer(app);
setupWebsocket(server);
startCronJobs(broadcastToAll);
require("./services/mailer");

app.use((req, res, next) => {
  if (req.path.endsWith(".html")) return res.redirect(301, req.path.slice(0,-5));
  next();
});

app.use((req, res) => res.status(404).send("Page not found"));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server + WebSocket running on port ${PORT}`);
});
