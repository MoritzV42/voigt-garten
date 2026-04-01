"""
Storage Backend Interface for Voigt-Garten.
Currently uses local filesystem. Interface prepared for future
Google Drive / Hetzner Storage Box backends.
"""

import os
import shutil


class StorageBackend:
    """Abstract storage interface."""

    def save(self, file_data, relative_path: str) -> str:
        raise NotImplementedError

    def delete(self, relative_path: str) -> bool:
        raise NotImplementedError

    def get_url(self, relative_path: str) -> str:
        raise NotImplementedError

    def exists(self, relative_path: str) -> bool:
        raise NotImplementedError


class LocalStorage(StorageBackend):
    """Local filesystem storage backend."""

    def __init__(self, base_dir: str, url_prefix: str = '/images/gallery'):
        self.base_dir = base_dir
        self.url_prefix = url_prefix
        os.makedirs(base_dir, exist_ok=True)

    def save(self, file_data, relative_path: str) -> str:
        full_path = os.path.join(self.base_dir, relative_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        file_data.save(full_path)
        return relative_path

    def delete(self, relative_path: str) -> bool:
        full_path = os.path.join(self.base_dir, relative_path)
        if os.path.exists(full_path):
            try:
                os.remove(full_path)
                return True
            except Exception:
                return False
        return False

    def get_url(self, relative_path: str) -> str:
        return f"{self.url_prefix}/{relative_path}"

    def exists(self, relative_path: str) -> bool:
        return os.path.exists(os.path.join(self.base_dir, relative_path))

    def get_full_path(self, relative_path: str) -> str:
        return os.path.join(self.base_dir, relative_path)
