import os
from sqlalchemy import create_engine
# IMPORT UPDATE: declarative_base is now imported from sqlalchemy.orm
from sqlalchemy.orm import sessionmaker, declarative_base

# Updated credentials: username 'postgres' and password 'postgresql'
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql://postgres:postgresql@localhost:5432/attendance_db"
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# This line is now clean and won't trigger the MovedIn20Warning
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()