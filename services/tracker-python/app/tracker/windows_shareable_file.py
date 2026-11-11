"""Read a Windows control file without blocking its revocation."""
import ctypes
import msvcrt
import os
from ctypes import wintypes
from typing import BinaryIO

_GENERIC_READ = 0x80000000
_FILE_SHARE_READ = 1
_FILE_SHARE_WRITE = 2
_FILE_SHARE_DELETE = 4
_OPEN_EXISTING = 3
_FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000
_INVALID_HANDLE = wintypes.HANDLE(-1).value

_kernel = ctypes.WinDLL("kernel32", use_last_error=True)
_create_file = _kernel.CreateFileW
_create_file.argtypes = (
    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
    wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
)
_create_file.restype = wintypes.HANDLE
_close_handle = _kernel.CloseHandle
_close_handle.argtypes = (wintypes.HANDLE,)
_close_handle.restype = wintypes.BOOL


def open_read_delete_shared(path: os.PathLike) -> BinaryIO:
    handle = _create_file(
        os.fspath(path), _GENERIC_READ,
        _FILE_SHARE_READ | _FILE_SHARE_WRITE | _FILE_SHARE_DELETE,
        None, _OPEN_EXISTING, _FILE_FLAG_OPEN_REPARSE_POINT, None,
    )
    if handle == _INVALID_HANDLE:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY | os.O_NOINHERIT)
    except OSError:
        _close_handle(handle)
        raise
    try:
        return os.fdopen(fd, "rb")
    except Exception:
        os.close(fd)
        raise
