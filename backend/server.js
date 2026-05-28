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
const materialRequestBuilderRoutes = require("./routes/materialRequestBuilder");
const materialRequestMasterItemsRoutes = require("./routes/materialRequestMasterItems");
const materialManagement       = require("./routes/materialManagement")
const invoiceManagement        = require("./routes/invoiceManagement");
const chatRoutes               = require("./routes/chatRoutes");
const meetRoutes               = require("./routes/teams");
const incidentRoutes           = require("./routes/incidentRoutes");
const aiAgentRoutes            = require("./routes/aiAgent");
const dailyWorksheetRoutes     = require("./routes/dailyWorksheet");
const noteTaskRoutes           = require("./routes/noteTasks");
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
app.use(bodyParser.json({ limit: "2mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "2mb" }));
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
app.use("/api/materialRequestBuilder", materialRequestBuilderRoutes);
app.use("/api/materialRequestMasterItems", materialRequestMasterItemsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/meet", meetRoutes);
app.use("/api/teams", meetRoutes);
app.use("/api", incidentRoutes);
app.use("/api/ai", aiAgentRoutes);
app.use("/api", dailyWorksheetRoutes);
app.use("/api", noteTaskRoutes);
app.use("/api/materialManagement", materialManagement);
app.use("/api/invoiceManagement", invoiceManagement);
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

app.get("/external-meeting", (req, res) => {
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>RELCON External Meeting</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
<style>
	body{margin:0;font-family:Inter,Arial,sans-serif;background:#111;color:#e5e7eb;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:18px;}
	.wrap{width:min(980px,100%);height:min(720px,92vh);background:#1f1f1f;border:1px solid rgba(255,255,255,.12);border-radius:10px;box-shadow:0 30px 90px rgba(0,0,0,.48);overflow:hidden;display:flex;flex-direction:column;}
	.head{height:52px;padding:0 16px;background:#242424;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,.1);}
	.head i{width:32px;height:32px;border-radius:8px;background:#5b5fc7;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;}
	.title{font-size:20px;font-weight:800}.sub{font-size:13px;color:#cbd5e1;margin-top:3px;}
	.body{padding:14px;display:grid;grid-template-rows:auto auto 1fr auto;gap:12px;min-height:0;flex:1;}
	.panel{background:#252525;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:12px;}
label{display:block;font-size:12px;font-weight:800;color:#cbd5e1;margin-bottom:7px;text-transform:uppercase;letter-spacing:.05em;}
	input{width:100%;height:42px;border:1px solid rgba(255,255,255,.16);border-radius:6px;background:#1b1b1b;color:#fff;padding:0 12px;font:500 13px Inter,Arial,sans-serif;box-sizing:border-box;}
	.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
	button{height:42px;border:0;border-radius:999px;padding:0 14px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:8px;}
	.primary{background:#237b4b;color:#fff}.danger{background:#c4314b;color:#fff}.ghost{background:#333;color:#e5e7eb;border:1px solid rgba(255,255,255,.12);}
	.stage{position:relative;min-height:0;background:#0b0b0b;border:1px solid rgba(255,255,255,.1);border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;}
	video{width:100%;height:100%;object-fit:cover;display:none;background:#020617;}
	.local{position:absolute;right:14px;bottom:14px;width:170px;aspect-ratio:16/10;border-radius:8px;border:1px solid rgba(255,255,255,.24);box-shadow:0 12px 28px rgba(0,0,0,.35);}
.empty{color:#94a3b8;text-align:center;font-weight:700}.status{font-size:13px;color:#cbd5e1;font-weight:700;}
.pill{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px;border-radius:999px;background:#064e3b;color:#d1fae5;font-size:12px;font-weight:800;}
@media(max-width:640px){.stage{min-height:280px}.local{width:120px}.row button{flex:1;justify-content:center;}}
</style>
</head>
<body>
<div class="wrap">
  <div class="head"><i class="fa-solid fa-video"></i><div><div class="title">RELCON Meeting Access</div><div class="sub">External users can join meetings only. CRM app access is not available from this page.</div></div></div>
  <div class="body">
    <div class="panel">
      <div class="row" style="justify-content:space-between;"><span class="pill" id="guestName">Verified external guest</span><span class="status" id="status">Ready</span></div>
    </div>
    <div class="panel">
      <label>RELCON meeting link</label>
      <div class="row"><input id="meetingLink" placeholder="Paste RELCON meeting join link here"/><button class="ghost" onclick="loadMeetingFromInput()"><i class="fa-solid fa-link"></i> Load</button></div>
    </div>
    <div class="stage">
      <div class="empty" id="emptyState">Load a meeting link, then join.</div>
	      <video id="remoteVideo" autoplay playsinline muted></video>
	      <audio id="remoteAudio" autoplay playsinline></audio>
	      <video id="localVideo" class="local" autoplay playsinline muted></video>
    </div>
    <div class="row">
      <button class="primary" onclick="joinMeeting()"><i class="fa-solid fa-phone"></i> Join Meeting</button>
      <button class="ghost" id="muteBtn" onclick="toggleMute()"><i class="fa-solid fa-microphone"></i> Mute</button>
      <button class="ghost" id="camBtn" onclick="toggleCamera()"><i class="fa-solid fa-video"></i> Camera</button>
      <button class="danger" onclick="leaveMeeting()"><i class="fa-solid fa-phone-slash"></i> Leave</button>
    </div>
  </div>
</div>
<script>
function decodeAccess(){try{let v=new URLSearchParams(location.search).get('access')||'';v=v.replace(/-/g,'+').replace(/_/g,'/');while(v.length%4)v+='=';return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v),c=>c.charCodeAt(0))));}catch{return null;}}
function decodeMeeting(v){try{v=String(v||'').replace(/-/g,'+').replace(/_/g,'/');while(v.length%4)v+='=';return JSON.parse(decodeURIComponent(escape(atob(v))));}catch{return null;}}
function meetingDisplayLink(){if(!meeting)return'';if(meeting.joinUrl)return meeting.joinUrl;return meeting.subject?('RELCON meeting: '+meeting.subject):'RELCON meeting loaded';}
const VIDEO_CONSTRAINTS={width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30},facingMode:'user'};
const access=decodeAccess();let meeting=null,ws=null,pc=null,localStream=null,muted=false,cameraOff=false;
if(!access?.token){document.getElementById('status').textContent='Invalid meeting access';}
else{document.getElementById('guestName').textContent=access.name||'Verified external guest'; if(access.meeting){meeting=decodeMeeting(access.meeting); renderMeeting();}}
function setStatus(t){document.getElementById('status').textContent=t;}
function renderMeeting(){if(!meeting)return;document.getElementById('meetingLink').value=meetingDisplayLink();document.getElementById('emptyState').textContent=meeting.subject?('Ready to join: '+meeting.subject):'Ready to join meeting';}
function loadMeetingFromInput(){const raw=document.getElementById('meetingLink').value.trim();try{const u=new URL(raw);meeting=decodeMeeting(u.searchParams.get('relconMeeting')||u.searchParams.get('meeting')||'');if(!meeting)throw new Error('Invalid link');renderMeeting();setStatus('Meeting loaded');}catch(e){setStatus('Invalid RELCON meeting link');}}
function wsUrl(){const proto=location.protocol==='https:'?'wss':'ws';return proto+'://'+location.host+'/ws?token='+encodeURIComponent(access.token);}
function send(payload){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'call_signal',...payload}));}
function ensureWs(){return new Promise((resolve,reject)=>{if(ws&&ws.readyState===WebSocket.OPEN)return resolve();ws=new WebSocket(wsUrl());ws.onopen=resolve;ws.onerror=()=>reject(new Error('Connection failed'));ws.onmessage=onWsMessage;});}
function tuneSender(sender){try{const p=sender.getParameters();p.degradationPreference='maintain-resolution';p.encodings=p.encodings?.length?p.encodings:[{}];p.encodings[0].maxBitrate=5000000;p.encodings[0].maxFramerate=30;p.encodings[0].scaleResolutionDownBy=1;sender.setParameters(p).catch(()=>{});}catch{}}
function tuneStream(stream){stream?.getVideoTracks?.().forEach(t=>{try{t.contentHint='motion';}catch{};t.applyConstraints?.(VIDEO_CONSTRAINTS).catch(()=>{});});}
function makePc(peer){pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});pc.onicecandidate=e=>{if(e.candidate)send({signalType:'candidate',callId:meeting.id,channel:meeting.channel,mediaKind:'video',candidate:e.candidate});};pc.ontrack=e=>{const stream=e.streams[0];const rv=document.getElementById('remoteVideo');const ra=document.getElementById('remoteAudio');rv.srcObject=stream;ra.srcObject=stream;rv.style.display=stream?.getVideoTracks().length?'block':'none';ra.play?.().catch(()=>{});document.getElementById('emptyState').style.display='none';setStatus('Connected');};localStream.getTracks().forEach(t=>{const sender=pc.addTrack(t,localStream);if(t.kind==='video')tuneSender(sender);});return pc;}
async function onWsMessage(ev){let msg;try{msg=JSON.parse(ev.data);}catch{return;}if(msg.type!=='call_signal'||!meeting||msg.callId!==meeting.id||msg.from===access.name)return;if(msg.signalType==='offer'){makePc(msg.from);await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));const ans=await pc.createAnswer();await pc.setLocalDescription(ans);send({signalType:'answer',callId:meeting.id,to:msg.from,channel:meeting.channel,mediaKind:'video',sdp:ans});}if(msg.signalType==='candidate'&&pc){await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(()=>{});}if(msg.signalType==='end'){setStatus('Meeting ended');leaveMeeting(false);}}
async function joinMeeting(){if(!access?.token)return setStatus('Invalid external access');if(!meeting)return setStatus('Load meeting link first');await ensureWs();localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:VIDEO_CONSTRAINTS});tuneStream(localStream);const lv=document.getElementById('localVideo');lv.srcObject=localStream;lv.style.display='block';send({signalType:'join',callId:meeting.id,channel:meeting.channel,mediaKind:'video'});setStatus('Joining...');}
function toggleMute(){if(!localStream)return;muted=!muted;localStream.getAudioTracks().forEach(t=>t.enabled=!muted);document.getElementById('muteBtn').classList.toggle('primary',muted);}
function toggleCamera(){if(!localStream)return;cameraOff=!cameraOff;localStream.getVideoTracks().forEach(t=>t.enabled=!cameraOff);document.getElementById('camBtn').classList.toggle('primary',cameraOff);}
function leaveMeeting(notify=true){if(notify&&meeting)send({signalType:'end',callId:meeting.id,channel:meeting.channel,mediaKind:'video'});try{pc&&pc.close();}catch{}pc=null;localStream&&localStream.getTracks().forEach(t=>t.stop());localStream=null;setStatus('Left meeting');}
</script>
</body>
</html>`);
});

// ✅ Block direct .html file access — URL se koi bhi .html directly open na ho
app.use((req, res, next) => {
  if (req.path.endsWith(".html")) {
    return res.status(403).json({ error: "Direct file access not allowed" });
  }
  next();
});

app.use((req, res) => res.status(404).send("Page not found"));

app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request payload is too large. Please keep the profile photo within 500 KB." });
  }
  if (err) {
    console.error("Unhandled server error:", err.message || err);
    return res.status(500).json({ error: "Internal server error" });
  }
  next();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server + WebSocket running on port ${PORT}`);
});
