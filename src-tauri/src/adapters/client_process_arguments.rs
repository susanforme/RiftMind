use std::{ffi::c_void, mem::size_of, ptr};

const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;
const MAX_COMMAND_LINE_BYTES: u32 = 128 * 1024;

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *const u16,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryInformationProcess(
        handle: *mut c_void,
        information_class: u32,
        buffer: *mut c_void,
        buffer_length: u32,
        returned_length: *mut u32,
    ) -> i32;
}

struct ProcessHandle(*mut c_void);

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        // The handle is owned by this guard and was checked when opened.
        unsafe { CloseHandle(self.0) };
    }
}

pub fn read_command_line(pid: u32) -> Option<String> {
    // Querying the command line does not require reading the client's process memory.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let handle = ProcessHandle(handle);
    let mut required_bytes = 0;
    unsafe {
        NtQueryInformationProcess(
            handle.0,
            PROCESS_COMMAND_LINE_INFORMATION,
            ptr::null_mut(),
            0,
            &mut required_bytes,
        );
    }
    for _ in 0..3 {
        if !(size_of::<UnicodeString>() as u32..=MAX_COMMAND_LINE_BYTES).contains(&required_bytes) {
            return None;
        }
        let buffer_bytes = required_bytes;
        let mut buffer = vec![0_usize; (buffer_bytes as usize).div_ceil(size_of::<usize>())];
        // The aligned allocation remains alive for both the query and decoding.
        let status = unsafe {
            NtQueryInformationProcess(
                handle.0,
                PROCESS_COMMAND_LINE_INFORMATION,
                buffer.as_mut_ptr().cast(),
                buffer_bytes,
                &mut required_bytes,
            )
        };
        if status >= 0 {
            return decode_command_line(&buffer);
        }
        if required_bytes <= buffer_bytes {
            return None;
        }
    }
    None
}

fn decode_command_line(buffer: &[usize]) -> Option<String> {
    if std::mem::size_of_val(buffer) < size_of::<UnicodeString>() {
        return None;
    }
    // usize alignment covers the native UNICODE_STRING header.
    let command_line = unsafe { &*buffer.as_ptr().cast::<UnicodeString>() };
    let start = command_line.buffer as usize;
    let allocation_start = buffer.as_ptr() as usize;
    let end = start.checked_add(command_line.length as usize)?;
    if command_line.length == 0
        || command_line.length % 2 != 0
        || command_line.length > command_line.maximum_length
        || start % align_of::<u16>() != 0
        || start < allocation_start + size_of::<UnicodeString>()
        || end > allocation_start + std::mem::size_of_val(buffer)
    {
        return None;
    }
    // The UTF-16 slice is aligned and fully contained in the owned query buffer.
    let characters = unsafe {
        std::slice::from_raw_parts(command_line.buffer, command_line.length as usize / 2)
    };
    String::from_utf16(characters).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_current_process_without_memory_read_access() {
        let command_line = read_command_line(std::process::id()).unwrap();
        let executable = std::env::current_exe().unwrap();
        assert!(command_line.contains(executable.file_name().unwrap().to_str().unwrap()));
        assert!(read_command_line(u32::MAX).is_none());
    }

    #[test]
    fn validates_native_command_line_buffer_bounds() {
        assert!(decode_command_line(&[]).is_none());
        let mut buffer = vec![0_usize; 32];
        let header_bytes = size_of::<UnicodeString>();
        let text = "客户端 --region=TENCENT".encode_utf16().collect::<Vec<_>>();
        let text_pointer = unsafe {
            buffer
                .as_mut_ptr()
                .cast::<u8>()
                .add(header_bytes)
                .cast::<u16>()
        };
        unsafe {
            ptr::copy_nonoverlapping(text.as_ptr(), text_pointer, text.len());
            ptr::write(
                buffer.as_mut_ptr().cast::<UnicodeString>(),
                UnicodeString {
                    length: (text.len() * 2) as u16,
                    maximum_length: (text.len() * 2) as u16,
                    buffer: text_pointer,
                },
            );
        }
        assert_eq!(
            decode_command_line(&buffer).as_deref(),
            Some("客户端 --region=TENCENT")
        );
        unsafe { (*buffer.as_mut_ptr().cast::<UnicodeString>()).buffer = ptr::null() };
        assert!(decode_command_line(&buffer).is_none());
        unsafe {
            let header = &mut *buffer.as_mut_ptr().cast::<UnicodeString>();
            header.buffer = text_pointer;
            header.length = 1;
        }
        assert!(decode_command_line(&buffer).is_none());
        unsafe { (*buffer.as_mut_ptr().cast::<UnicodeString>()).length = u16::MAX - 1 };
        assert!(decode_command_line(&buffer).is_none());
    }
}
