import base64
import numpy as np
import cv2
from datetime import datetime, date
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from database import engine, get_db

# Try using face_recognition
try:
    import face_recognition
except ImportError:
    raise ImportError("Dependencies missing. Install dlib, cmake, and face-recognition libraries.")

# Auto-build database tables
# Add this line temporarily to clear old layouts
models.Base.metadata.drop_all(bind=engine) 
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="FaceAttend Engine")

# Mount Static and Templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

def decode_base64_img(base64_str: str) -> np.ndarray:
    try:
        if "," in base64_str:
            base64_str = base64_str.split(",")[1]
        img_bytes = base64.b64decode(base64_str)
        nparr = np.frombuffer(img_bytes, np.uint8)
        return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid camera frame coding.")

@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

# --- Updated API Services ---

@app.get("/api/students")
def get_students(db: Session = Depends(get_db)):
    students = db.query(models.Student).all()
    # Returns the expanded demographic object array
    return [{
        "id": s.student_id, 
        "name": s.name, 
        "semester": s.semester,
        "year": s.year,
        "passing_year": s.passing_year,
        "course": s.course, 
        "faceStatus": "Registered"
    } for s in students]

@app.delete("/api/students/{student_id}")
def delete_student(student_id: str, db: Session = Depends(get_db)):
    student = db.query(models.Student).filter(models.Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found.")
    
    db.query(models.Student).filter(models.Student.student_id == student_id).delete()
    db.query(models.AttendanceLog).filter(models.AttendanceLog.student_id == student_id).delete()
    db.query(models.LeaveRecord).filter(models.LeaveRecord.student_id == student_id).delete()
    db.commit()
    return {"status": "success", "message": "Student profile erased."}

@app.post("/api/register")
def register_student(payload: models.StudentRegister, db: Session = Depends(get_db)):
    exists = db.query(models.Student).filter(models.Student.student_id == payload.student_id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Student ID already registered.")

    img = decode_base64_img(payload.image_base64)
    rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    face_locs = face_recognition.face_locations(rgb_img)
    if not face_locs:
        raise HTTPException(status_code=400, detail="No face detected in registration snapshot.")
        
    encodings = face_recognition.face_encodings(rgb_img, face_locs)
    encoding_list = encodings[0].tolist()

    new_student = models.Student(
        student_id=payload.student_id,
        name=payload.name,
        semester=payload.semester,
        year=payload.year,
        passing_year=payload.passing_year,
        course=payload.course,
        face_encoding=encoding_list
    )
    db.add(new_student)
    db.commit()
    return {"status": "success", "message": f"{payload.name} registered successfully!"}

@app.post("/api/verify")
def verify_attendance(payload: models.FaceVerification, db: Session = Depends(get_db)):
    img = decode_base64_img(payload.image_base64)
    rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    face_locs = face_recognition.face_locations(rgb_img)
    if not face_locs:
        raise HTTPException(status_code=400, detail="No face found in camera frame.")

    live_encoding = face_recognition.face_encodings(rgb_img, face_locs)[0]
    all_students = db.query(models.Student).all()
    if not all_students:
        raise HTTPException(status_code=404, detail="No registered students in database.")

    known_encodings = [np.array(s.face_encoding) for s in all_students]
    
    distances = face_recognition.face_distance(known_encodings, live_encoding)
    best_match_idx = np.argmin(distances)
    
    if distances[best_match_idx] <= 0.55:
        matched_student = all_students[best_match_idx]
        today = date.today()
        
        has_leave = db.query(models.LeaveRecord).filter(
            models.LeaveRecord.student_id == matched_student.student_id,
            models.LeaveRecord.leave_date == today
        ).first()
        
        assigned_status = "Present"
        if has_leave:
            assigned_status = "Approved Leave"
        else:
            now_time = datetime.now().time()
            if now_time > datetime.strptime("09:15:00", "%H:%M:%S").time():
                assigned_status = "Late"

        logged = db.query(models.AttendanceLog).filter(
            models.AttendanceLog.student_id == matched_student.student_id,
            func.date(models.AttendanceLog.timestamp) == today
        ).first()

        if logged:
            return {
                "status": "info",
                "message": f"Welcome back, {matched_student.name}!",
                "student_id": matched_student.student_id,
                "name": matched_student.name,
                "attendance_status": logged.status,
                "time": logged.timestamp.strftime("%I:%M %p")
            }

        new_log = models.AttendanceLog(student_id=matched_student.student_id, status=assigned_status)
        db.add(new_log)
        db.commit()
        db.refresh(new_log)

        return {
            "status": "success",
            "message": f"Marked {assigned_status}!",
            "student_id": matched_student.student_id,
            "name": matched_student.name,
            "attendance_status": assigned_status,
            "time": new_log.timestamp.strftime("%I:%M %p")
        }
    
    raise HTTPException(status_code=401, detail="Authentication failed. Unknown person.")

@app.get("/api/attendance/today")
def get_today_attendance(db: Session = Depends(get_db)):
    today = date.today()
    logs = db.query(models.AttendanceLog).filter(func.date(models.AttendanceLog.timestamp) == today).all()
    all_students = db.query(models.Student).all()
    
    logged_ids = {l.student_id for l in logs}
    records = []
    
    for l in logs:
        student = db.query(models.Student).filter(models.Student.student_id == l.student_id).first()
        if student:
            records.append({
                "id": student.student_id,
                "name": student.name,
                "time": l.timestamp.strftime("%I:%M %p"),
                "status": l.status
            })
            
    for s in all_students:
        if s.student_id not in logged_ids:
            records.append({
                "id": s.student_id,
                "name": s.name,
                "time": "---",
                "status": "Absent"
            })
            
    return records

@app.post("/api/leaves")
def apply_leave(payload: models.LeaveApply, db: Session = Depends(get_db)):
    student = db.query(models.Student).filter(models.Student.student_id == payload.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student ID does not exist.")
    
    target_date = datetime.strptime(payload.leave_date, "%Y-%m-%d").date()
    
    new_leave = models.LeaveRecord(
        student_id=payload.student_id,
        leave_date=target_date,
        reason=payload.reason
    )
    db.add(new_leave)
    
    if target_date == date.today():
        today_log = db.query(models.AttendanceLog).filter(
            models.AttendanceLog.student_id == payload.student_id,
            func.date(models.AttendanceLog.timestamp) == target_date
        ).first()
        if today_log:
            today_log.status = "Approved Leave"
        else:
            db.add(models.AttendanceLog(student_id=payload.student_id, status="Approved Leave"))
            
    db.commit()
    return {"status": "success", "message": "Leave application recorded."}

@app.get("/api/leaves")
def get_leaves(db: Session = Depends(get_db)):
    leaves = db.query(models.LeaveRecord).all()
    return [{
        "id": l.student_id,
        "date": l.leave_date.strftime("%Y-%m-%d"),
        "reason": l.reason,
        "status": "Approved Leave"
    } for l in leaves]

@app.get("/api/reports/{report_type}")
def get_report(report_type: str, db: Session = Depends(get_db)):
    if report_type == "daily":
        return get_today_attendance(db)
    elif report_type == "absentee":
        records = get_today_attendance(db)
        return [r for r in records if r["status"] == "Absent"]
    elif report_type == "monthly":
        students = db.query(models.Student).all()
        report = []
        for s in students:
            logs_count = db.query(models.AttendanceLog).filter(
                models.AttendanceLog.student_id == s.student_id
            ).count()
            leaves_count = db.query(models.LeaveRecord).filter(
                models.LeaveRecord.student_id == s.student_id
            ).count()
            
            yield_pct = f"{min(100, int(((logs_count + leaves_count) / 20) * 100))}%" if logs_count else "0%"
            report.append({
                "id": s.student_id,
                "name": s.name,
                "yield": yield_pct,
                "leaves": leaves_count
            })
        return report