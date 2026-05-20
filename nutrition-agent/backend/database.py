from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from typing import Generator
from config import Config


engine = create_engine(
    Config.DATABASE_URL,
    # check_same_thread is only needed for SQLite
    connect_args={"check_same_thread": False} if "sqlite" in Config.DATABASE_URL else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    import models  # noqa: F401 — side-effect import registers all ORM classes with Base
    Base.metadata.create_all(bind=engine)
