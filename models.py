from sqlalchemy import Column, Integer, String, DateTime, ARRAY, Float, Date
from sqlalchemy.sql import func
from database import Base
from pydantic import BaseModel

# --- SQLAlchemy Models ---

class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    semester = Column(String, nullable=False)        # Added: e.g., "Semester 3"
    year = Column(String, nullable=False)            # Added: "1st Year", "2nd Year", etc.
    passing_year = Column(String, nullable=False)    # Added: e.g., "2028"
    course = Column(String, nullable=False)          # Updated to a dropdown configuration
    face_encoding = Column(ARRAY(Float), nullable=False)

class AttendanceLog(Base):
    __tablename__ = "attendance_logs"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String, default="Present")

class LeaveRecord(Base):
    __tablename__ = "leaves"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    leave_date = Column(Date, nullable=False)
    reason = Column(String, nullable=False)

# --- Pydantic Schema Validations ---

class StudentRegister(BaseModel):
    student_id: str
    name: str
    semester: str
    year: str
    passing_year: str
    course: str
    image_base64: str

class FaceVerification(BaseModel):
    image_base64: str

class LeaveApply(BaseModel):
    student_id: str
    leave_date: str
    reason: str