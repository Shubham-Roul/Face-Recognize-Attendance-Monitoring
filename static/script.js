let cameraInterval = null;
let isCamRunning = false;
let activeStream = null;
let capturedFaceBase64 = null; // Stores image for registration

document.addEventListener("DOMContentLoaded", () => {
    initClock();
    initNavigation();
    loadDashboardAndStudents();
    initCameraControls();
    initFormHandlers();
    initReportGenerator();
});

// --- UI Navigation Engine ---
function initNavigation() {
    const menuItems = document.querySelectorAll(".menu-item");
    const sections = document.querySelectorAll(".content-section");
    const sectionTitle = document.getElementById("section-title");

    menuItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            menuItems.forEach(i => i.classList.remove("active"));
            sections.forEach(s => s.classList.remove("active"));
            
            item.classList.add("active");
            const targetId = item.getAttribute("data-target");
            document.getElementById(targetId).classList.add("active");
            sectionTitle.textContent = item.textContent.trim();
        });
    });
}

function initClock() {
    const clockEl = document.getElementById("live-clock");
    setInterval(() => {
        clockEl.textContent = new Date().toLocaleString();
    }, 1000);
}

// --- Fetch & Render Operations ---
async function loadDashboardAndStudents() {
    try {
        const studentRes = await fetch('/api/students');
        const students = await studentRes.json();
        renderStudentsTable(students);

        const logsRes = await fetch('/api/attendance/today');
        const logs = await logsRes.json();
        renderRealtimeLogs(logs, students.length);
        
        await loadLeavesTable();
    } catch (err) {
        console.error("Failure updating dashboard stats:", err);
    }
}

function renderStudentsTable(students) {
    const tbody = document.getElementById("student-table-body");
    tbody.innerHTML = "";
    students.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${s.id}</strong></td>
            <td>${s.name}</td>
            <td>
                <div style="font-size:0.85rem; color:var(--text-main);"><strong>${s.course}</strong></div>
                <div style="font-size:0.75rem; color:var(--text-muted);">${s.year} | ${s.semester} | Passing: ${s.passing_year}</div>
            </td>
            <td><span class="badge badge-present"><i class="fa-solid fa-circle-check"></i> Registered</span></td>
            <td><button class="btn btn-danger btn-sm" onclick="deleteStudent('${s.id}')"><i class="fa-solid fa-trash"></i></button></td>
        `;
        tbody.appendChild(tr);
    });
    document.getElementById("dash-total-students").textContent = students.length;
}

async function deleteStudent(id) {
    if(confirm(`Are you sure you want to remove student ID: ${id}?`)) {
        const response = await fetch(`/api/students/${id}`, { method: 'DELETE' });
        if(response.ok) loadDashboardAndStudents();
    }
}

function renderRealtimeLogs(records, totalStudents) {
    const tbody = document.getElementById("realtime-log-body");
    tbody.innerHTML = "";
    
    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;

    records.forEach(r => {
        let badgeClass = "badge-present";
        if (r.status === "Absent") { badgeClass = "badge-absent"; absentCount++; }
        else if (r.status === "Late") { badgeClass = "badge-late"; lateCount++; presentCount++; }
        else if (r.status === "Approved Leave") { badgeClass = "badge-leave"; absentCount++; }
        else { presentCount++; }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${r.name}</strong></td>
            <td>${r.id}</td>
            <td>${r.time}</td>
            <td><span class="badge ${badgeClass}">${r.status}</span></td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById("dash-present").textContent = presentCount;
    document.getElementById("dash-absent").textContent = absentCount;
    document.getElementById("dash-late").textContent = lateCount;
}

async function loadLeavesTable() {
    const res = await fetch('/api/leaves');
    const leaves = await res.json();
    const leaveTbody = document.getElementById("leave-table-body");
    leaveTbody.innerHTML = "";
    leaves.forEach(l => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${l.id}</strong></td>
            <td>${l.date}</td>
            <td>${l.reason}</td>
            <td><span class="badge badge-leave">${l.status}</span></td>
        `;
        leaveTbody.appendChild(tr);
    });
}

// --- Video Control & API Recognition Engine ---
function initCameraControls() {
    const startBtn = document.getElementById("btn-start-cam");
    const stopBtn = document.getElementById("btn-stop-cam");
    const placeholder = document.getElementById("camera-placeholder");
    const scanOverlay = document.getElementById("scan-result-overlay");
    const scannerLine = document.querySelector(".scanner-line");
    const videoFeed = document.getElementById("video-feed");

    startBtn.addEventListener("click", async () => {
        isCamRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        placeholder.style.display = "none";
        videoFeed.style.display = "block";
        scannerLine.style.display = "block";
        scanOverlay.style.display = "block";

        try {
            activeStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            videoFeed.srcObject = activeStream;
            
            // Run scanning engine iteration loop every 4.5 seconds
            cameraInterval = setInterval(sendCameraSnapshot, 4500);
        } catch (err) {
            alert("Could not load system webcam. Check hardware connections.");
            stopBtn.click();
        }
    });

    stopBtn.addEventListener("click", () => {
        isCamRunning = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
        scannerLine.style.display = "none";
        scanOverlay.style.display = "none";
        
        if (activeStream) {
            activeStream.getTracks().forEach(track => track.stop());
        }
        
        videoFeed.style.display = "none";
        placeholder.style.display = "flex";
        clearInterval(cameraInterval);
    });
}

// Captures a frame on canvas and formats it into base64 payload
function grabCanvasBase64() {
    // CRITICAL: Ensure this matches the ID "video-feed" from your index.html
    const video = document.getElementById("video-feed"); 
    const canvas = document.createElement("canvas");
    
    if (!video || video.paused || video.ended) {
        console.error("Camera stream is not active or element not found.");
        return null;
    }

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    
    // Draw the current webcam frame onto the hidden canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg");
}

async function sendCameraSnapshot() {
    if (!isCamRunning) return;
    
    const overlay = document.getElementById("scan-result-overlay");
    const displayBox = document.getElementById("scan-result-display");
    overlay.innerText = "Analyzing Face Frame...";

    try {
        const img64 = grabCanvasBase64();
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ image_base64: img64 })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            overlay.innerText = `Verified: ${data.name}`;
            let themeColor = data.attendance_status === "Present" ? "var(--success)" : "var(--warning)";
            
            displayBox.innerHTML = `
                <div class="result-card-scanned" style="animation: fadeIn 0.3s ease;">
                    <div class="result-avatar" style="border-color: ${themeColor}">
                        <i class="fa-solid fa-user"></i>
                    </div>
                    <h4>${data.name}</h4>
                    <p style="color:var(--text-muted); font-size:0.85rem;">ID: ${data.student_id}</p>
                    <p style="margin-top:10px;">Timestamp: <strong>${data.time}</strong></p>
                    <span class="badge ${data.attendance_status === 'Present' ? 'badge-present' : 'badge-late'}" style="margin-top:8px; display:inline-block;">
                        ${data.attendance_status}
                    </span>
                </div>
            `;
            loadDashboardAndStudents();
        } else {
            overlay.innerText = "Access Denied / Unknown Face";
        }
    } catch (err) {
        overlay.innerText = "Service Connectivity Interrupted";
    }
}

// --- Forms Submission Handlers ---
// --- Forms Submission Handlers (Registration & Leave Routing) ---
function initFormHandlers() {
    // 1. Student Registration Form & Capture Logic
    const studentForm = document.getElementById("student-form");
    const captureBox = document.getElementById("register-cam-box");

    document.getElementById("btn-capture-face").addEventListener("click", () => {
        if (!isCamRunning) {
            alert("Please go to the 'Live Attendance' tab and click 'Start Camera' first so the webcam stream is active.");
            return;
        }
        
        // Grab live base64 data string from the running video track
        capturedFaceBase64 = grabCanvasBase64();
        
        if (capturedFaceBase64) {
            const regCanvas = document.getElementById("register-preview-canvas");
            const regPlaceholder = document.getElementById("register-placeholder-text");
            const videoEl = document.getElementById("video-feed");
            
            // Paint the static frame onto the registration preview box visually
            const ctx = regCanvas.getContext("2d");
            regCanvas.width = videoEl.videoWidth || 640;
            regCanvas.height = videoEl.videoHeight || 480;
            ctx.drawImage(videoEl, 0, 0, regCanvas.width, regCanvas.height);
            
            // Toggle visual element structures
            regPlaceholder.style.display = "none";
            regCanvas.style.display = "block";
            captureBox.style.borderColor = "var(--success)";
            captureBox.style.borderStyle = "solid";
            
            console.log("Biometric target payload successfully loaded into memory.");
        }
    });

    studentForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!capturedFaceBase64) {
            alert("Please capture the student biometric face structure snapshot layout first.");
            return;
        }

        // Capture all form elements including the new dropdown metadata
        const studentId = document.getElementById("stud-id").value.trim();
        const name = document.getElementById("stud-name").value.trim();
        const year = document.getElementById("stud-year").value;
        const semester = document.getElementById("stud-semester").value;
        const course = document.getElementById("stud-course").value;
        const passingYear = document.getElementById("stud-passing-year").value;

        const payload = {
            student_id: studentId,
            name: name,
            year: year,
            semester: semester,
            course: course,
            passing_year: passingYear,
            image_base64: capturedFaceBase64
        };

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            if (response.ok) {
                alert(data.message || "Student registered successfully!");
                
                // Reset form inputs
                studentForm.reset();
                
                // Reset face preview canvas UI state
                capturedFaceBase64 = null;
                const regCanvas = document.getElementById("register-preview-canvas");
                const regPlaceholder = document.getElementById("register-placeholder-text");
                
                regCanvas.style.display = "none";
                regPlaceholder.style.display = "block";
                captureBox.style.borderColor = "var(--border)";
                captureBox.style.borderStyle = "dashed";
                
                // Refresh tables across interface dynamically
                loadDashboardAndStudents();
            } else {
                alert(data.detail || "Error processing image vector registration components.");
            }
        } catch (err) {
            console.error("Network interface connection failure:", err);
            alert("Could not reach server database backend.");
        }
    });

    // 2. Leave Management Automation Submission Handler
    const leaveForm = document.getElementById("leave-form");

    leaveForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const payload = {
            student_id: document.getElementById("leave-stud-id").value.trim(),
            leave_date: document.getElementById("leave-date").value,
            reason: document.getElementById("leave-reason").value.trim()
        };

        try {
            const response = await fetch('/api/leaves', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                alert("Leave granted and attendance properties overwritten successfully!");
                leaveForm.reset();
                loadDashboardAndStudents();
            } else {
                const errData = await response.json();
                alert(errData.detail || "Error recording leave authorization parameters.");
            }
        } catch (err) {
            console.error("Server synchronization mismatch:", err);
            alert("Failed to submit leave adjustment data.");
        }
    });
}
// --- Reports Compilations Data Aggregator Engine ---
function initReportGenerator() {
    const generateBtn = document.getElementById("btn-generate-report");
    const reportType = document.getElementById("report-type");
    const titleDisplay = document.getElementById("report-title-display");
    const tableHead = document.getElementById("report-table-head");
    const tableBody = document.getElementById("report-table-body");

    generateBtn.addEventListener("click", async () => {
        const selected = reportType.value;
        tableBody.innerHTML = "<tr><td colspan='4' style='text-align:center;'>Compiling datasets...</td></tr>";

        const response = await fetch(`/api/reports/${selected}`);
        const data = await response.json();
        tableBody.innerHTML = "";

        if (selected === "daily") {
            titleDisplay.textContent = "Daily Attendance Log";
            tableHead.innerHTML = `
                <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Time Verified</th>
                    <th>Status Flag</th>
                </tr>
            `;
            data.forEach(r => {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td>${r.id}</td><td>${r.name}</td><td>${r.time}</td><td><strong>${r.status}</strong></td>`;
                tableBody.appendChild(tr);
            });
        } else if (selected === "absentee") {
            titleDisplay.textContent = "Defaulter / Absentee Report";
            tableHead.innerHTML = `
                <tr>
                    <th>Student ID</th>
                    <th>Defaulter Name</th>
                    <th>Status Metrics</th>
                </tr>
            `;
            if(data.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center;">No students marked absent today!</td></tr>`;
            } else {
                data.forEach(r => {
                    const tr = document.createElement("tr");
                    tr.innerHTML = `<td>${r.id}</td><td>${r.name}</td><td><span class="badge badge-absent">Absent</span></td>`;
                    tableBody.appendChild(tr);
                });
            }
        } else if (selected === "monthly") {
            titleDisplay.textContent = "Monthly Aggregated Frequency Metric Report";
            tableHead.innerHTML = `
                <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Attendance Yield (%)</th>
                    <th>Leaves Approved</th>
                </tr>
            `;
            data.forEach(r => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${r.id}</td>
                    <td>${r.name}</td>
                    <td><strong>${r.yield}</strong></td>
                    <td>${r.leaves}</td>
                `;
                tableBody.appendChild(tr);
            });
        }
    });
}