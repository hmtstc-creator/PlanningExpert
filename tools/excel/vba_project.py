"""vbaProject.bin writer (MS-OVBA + MS-CFB), source-only VBA project.

Excel recompiles a project whose _VBA_PROJECT stream has version 0xFFFF from
the module source, so no p-code is written. Used by build_excel.py.
"""
from __future__ import annotations

import random
import struct
import uuid

# ---------------------------------------------------------------------------
# MS-OVBA 2.4.1 compression
# ---------------------------------------------------------------------------


def _copy_token_help(difference: int) -> tuple[int, int, int]:
    bit_count = max((difference - 1).bit_length(), 4)
    length_mask = 0xFFFF >> bit_count
    maximum_length = length_mask + 3
    return bit_count, length_mask, maximum_length


def compress(data: bytes) -> bytes:
    out = bytearray(b"\x01")
    pos = 0
    n = len(data)
    while pos < n:
        chunk_start = pos
        chunk_end = min(pos + 4096, n)
        body = bytearray()
        seen: dict[bytes, list[int]] = {}

        def remember(upto: int) -> None:
            # index every position of the chunk before `upto` by its 3-byte prefix
            while remember.next < upto:
                q = remember.next
                if q + 3 <= chunk_end:
                    seen.setdefault(data[q:q + 3], []).append(q)
                remember.next += 1

        remember.next = chunk_start  # type: ignore[attr-defined]
        while pos < chunk_end:
            flag_index = len(body)
            body.append(0)
            flags = 0
            for bit in range(8):
                if pos >= chunk_end:
                    break
                difference = pos - chunk_start
                best_len = 0
                best_off = 0
                if difference > 0:
                    bit_count, _mask, max_len = _copy_token_help(difference)
                    max_len = min(max_len, chunk_end - pos)
                    # longest match inside the chunk (candidates share the 3-byte prefix)
                    remember(pos)
                    for cand in reversed(seen.get(data[pos:pos + 3], [])[-64:]):
                        length = 0
                        while length < max_len and data[cand + length] == data[pos + length]:
                            length += 1
                        if length > best_len:
                            best_len = length
                            best_off = pos - cand
                            if length == max_len:
                                break
                if best_len >= 3:
                    bit_count, _mask, _max = _copy_token_help(difference)
                    token = ((best_off - 1) << (16 - bit_count)) | (best_len - 3)
                    body += struct.pack("<H", token)
                    flags |= 1 << bit
                    pos += best_len
                else:
                    body.append(data[pos])
                    pos += 1
            body[flag_index] = flags
        if len(body) > 4096:
            raise ValueError("chunk does not compress; source text expected")
        header = (len(body) + 2 - 3) & 0x0FFF
        header |= 0x3000 | 0x8000
        out += struct.pack("<H", header)
        out += body
    return bytes(out)


def decompress(data: bytes) -> bytes:
    """Reference decompressor (used by the self-test)."""
    assert data[0] == 1
    out = bytearray()
    pos = 1
    while pos < len(data):
        header = struct.unpack_from("<H", data, pos)[0]
        size = (header & 0x0FFF) + 3
        compressed = header & 0x8000
        chunk_end = pos + size
        pos += 2
        chunk_start = len(out)
        if not compressed:
            out += data[pos:pos + 4096]
            pos += 4096
            continue
        while pos < chunk_end:
            flags = data[pos]
            pos += 1
            for bit in range(8):
                if pos >= chunk_end:
                    break
                if flags & (1 << bit):
                    token = struct.unpack_from("<H", data, pos)[0]
                    pos += 2
                    difference = len(out) - chunk_start
                    bit_count, length_mask, _ = _copy_token_help(difference)
                    length = (token & length_mask) + 3
                    offset = (token >> (16 - bit_count)) + 1
                    for _ in range(length):
                        out.append(out[-offset])
                else:
                    out.append(data[pos])
                    pos += 1
    return bytes(out)


# ---------------------------------------------------------------------------
# MS-OVBA 2.4.3 data encryption (CMG / DPB / GC of the PROJECT stream)
# ---------------------------------------------------------------------------


def _encrypt(project_id: str, data: bytes, seed: int) -> str:
    version = 2
    proj_key = sum(project_id.encode("latin-1")) & 0xFF
    out = bytearray([seed, seed ^ version, seed ^ proj_key])
    unencrypted_byte1 = proj_key
    encrypted_byte1 = seed ^ proj_key
    encrypted_byte2 = seed ^ version
    ignored_length = (seed & 6) // 2
    for _ in range(ignored_length):
        temp = 0
        byte_enc = temp ^ ((encrypted_byte2 + unencrypted_byte1) & 0xFF)
        out.append(byte_enc)
        encrypted_byte2 = encrypted_byte1
        encrypted_byte1 = byte_enc
        unencrypted_byte1 = temp
    for byte in struct.pack("<I", len(data)) + data:
        byte_enc = byte ^ ((encrypted_byte2 + unencrypted_byte1) & 0xFF)
        out.append(byte_enc)
        encrypted_byte2 = encrypted_byte1
        encrypted_byte1 = byte_enc
        unencrypted_byte1 = byte
    return out.hex().upper()


def _decrypt(project_id: str, hex_text: str) -> bytes:
    data = bytes.fromhex(hex_text)
    seed, version_enc, proj_key_enc = data[0], data[1], data[2]
    assert seed ^ version_enc == 2
    proj_key = seed ^ proj_key_enc
    assert proj_key == sum(project_id.encode("latin-1")) & 0xFF
    unencrypted_byte1 = proj_key
    encrypted_byte1 = proj_key_enc
    encrypted_byte2 = version_enc
    pos = 3
    for _ in range((seed & 6) // 2):
        byte_enc = data[pos]
        pos += 1
        byte = byte_enc ^ ((encrypted_byte2 + unencrypted_byte1) & 0xFF)
        encrypted_byte2 = encrypted_byte1
        encrypted_byte1 = byte_enc
        unencrypted_byte1 = byte
    plain = bytearray()
    for byte_enc in data[pos:]:
        byte = byte_enc ^ ((encrypted_byte2 + unencrypted_byte1) & 0xFF)
        plain.append(byte)
        encrypted_byte2 = encrypted_byte1
        encrypted_byte1 = byte_enc
        unencrypted_byte1 = byte
    length = struct.unpack_from("<I", plain, 0)[0]
    return bytes(plain[4:4 + length])


# ---------------------------------------------------------------------------
# dir stream (MS-OVBA 2.3.4.2)
# ---------------------------------------------------------------------------


def _rec(rec_id: int, payload: bytes) -> bytes:
    return struct.pack("<HI", rec_id, len(payload)) + payload


def _u16le(text: str) -> bytes:
    return text.encode("utf-16-le")


def _dir_stream(modules: list[tuple[str, str, bool]], codepage: str = "cp1252") -> bytes:
    """modules: (name, source, is_document)."""
    out = bytearray()
    out += _rec(0x0001, struct.pack("<I", 1))  # SYSKIND win32
    out += _rec(0x0002, struct.pack("<I", 0x409))  # LCID
    out += _rec(0x0014, struct.pack("<I", 0x409))  # LCIDINVOKE
    out += _rec(0x0003, struct.pack("<H", 1252))  # CODEPAGE
    out += _rec(0x0004, b"VBAProject")  # NAME
    out += _rec(0x0005, b"") + _rec(0x0040, b"")  # DOCSTRING + unicode
    out += _rec(0x0006, b"") + _rec(0x003D, b"")  # HELPFILEPATH 1 + 2
    out += _rec(0x0007, struct.pack("<I", 0))  # HELPCONTEXT
    out += _rec(0x0008, struct.pack("<I", 0))  # LIBFLAGS
    out += struct.pack("<HIIH", 0x0009, 4, 1, 0)  # VERSION (reserved=4, major, minor)
    out += _rec(0x000C, b"") + _rec(0x003C, b"")  # CONSTANTS + unicode
    # reference: OLE Automation (stdole)
    ref_name = "stdole"
    out += _rec(0x0016, ref_name.encode("latin-1")) + _rec(0x003E, _u16le(ref_name))
    libid = b"*\\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\\Windows\\System32\\stdole2.tlb#OLE Automation"
    registered = struct.pack("<I", len(libid)) + libid + struct.pack("<IH", 0, 0)
    out += _rec(0x000D, registered)
    # modules
    out += _rec(0x000F, struct.pack("<H", len(modules)))
    out += _rec(0x0013, struct.pack("<H", 0xFFFF))
    for name, _source, is_document in modules:
        out += _rec(0x0019, name.encode(codepage))
        out += _rec(0x0047, _u16le(name))
        out += _rec(0x001A, name.encode(codepage)) + _rec(0x0032, _u16le(name))
        out += _rec(0x001C, b"") + _rec(0x0048, b"")
        out += _rec(0x0031, struct.pack("<I", 0))  # text offset: no performance cache
        out += _rec(0x001E, struct.pack("<I", 0))
        out += _rec(0x002C, struct.pack("<H", 0xFFFF))
        out += _rec(0x0022 if is_document else 0x0021, b"")
        out += _rec(0x002B, b"")  # module terminator
    out += _rec(0x0010, b"")  # dir terminator
    return bytes(out)


def _project_stream(project_id: str, modules: list[tuple[str, str, bool]], seed: random.Random) -> bytes:
    lines = [f'ID="{project_id}"']
    for name, _src, is_document in modules:
        if is_document:
            lines.append(f"Document={name}/&H00000000")
    for name, _src, is_document in modules:
        if not is_document:
            lines.append(f"Module={name}")
    lines += [
        'Name="VBAProject"',
        'HelpContextID="0"',
        'VersionCompatible32="393222000"',
        f'CMG="{_encrypt(project_id, struct.pack("<I", 0), seed.randrange(256))}"',
        f'DPB="{_encrypt(project_id, bytes([0]), seed.randrange(256))}"',
        f'GC="{_encrypt(project_id, bytes([0xFF]), seed.randrange(256))}"',
        "",
        "[Host Extender Info]",
        "&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000",
        "",
        "[Workspace]",
    ]
    for name, _src, _doc in modules:
        lines.append(f"{name}=0, 0, 0, 0, C")
    return ("\r\n".join(lines) + "\r\n").encode("cp1252")


def _project_wm(modules: list[tuple[str, str, bool]]) -> bytes:
    out = bytearray()
    for name, _src, _doc in modules:
        out += name.encode("cp1252") + b"\x00" + _u16le(name) + b"\x00\x00"
    out += b"\x00\x00"
    return bytes(out)


# ---------------------------------------------------------------------------
# MS-CFB writer (version 3, 512-byte sectors, mini stream for < 4096 bytes)
# ---------------------------------------------------------------------------

FREESECT = 0xFFFFFFFF
ENDOFCHAIN = 0xFFFFFFFE
FATSECT = 0xFFFFFFFD
NOSTREAM = 0xFFFFFFFF
SECTOR = 512
MINI = 64
CUTOFF = 4096


class _Entry:
    def __init__(self, name: str, kind: int, data: bytes = b""):
        self.name = name
        self.kind = kind  # 1 storage, 2 stream, 5 root
        self.data = data
        self.children: list[_Entry] = []
        self.left = NOSTREAM
        self.right = NOSTREAM
        self.child = NOSTREAM
        self.start = ENDOFCHAIN
        self.size = 0
        self.index = 0


def _cfb_key(name: str) -> tuple[int, str]:
    return (len(name), name.upper())


def _build_tree(entries: list[_Entry]) -> int:
    """Balanced binary search tree over siblings (all nodes black)."""
    ordered = sorted(entries, key=lambda e: _cfb_key(e.name))

    def build(lo: int, hi: int) -> int:
        if lo > hi:
            return NOSTREAM
        mid = (lo + hi) // 2
        node = ordered[mid]
        node.left = build(lo, mid - 1)
        node.right = build(mid + 1, hi)
        return node.index

    return build(0, len(ordered) - 1)


def write_cfb(root_children: list[_Entry]) -> bytes:
    root = _Entry("Root Entry", 5)
    root.children = root_children
    all_entries: list[_Entry] = []

    def walk(e: _Entry) -> None:
        e.index = len(all_entries)
        all_entries.append(e)
        for c in e.children:
            walk(c)

    walk(root)
    for e in all_entries:
        if e.children:
            e.child = _build_tree(e.children)

    # mini stream
    mini_stream = bytearray()
    mini_fat: list[int] = []
    big_streams: list[_Entry] = []
    for e in all_entries:
        if e.kind != 2:
            continue
        e.size = len(e.data)
        if e.size == 0:
            e.start = ENDOFCHAIN
        elif e.size < CUTOFF:
            first = len(mini_fat)
            count = (e.size + MINI - 1) // MINI
            for i in range(count):
                mini_fat.append(first + i + 1 if i < count - 1 else ENDOFCHAIN)
            e.start = first
            mini_stream += e.data + b"\x00" * (count * MINI - e.size)
        else:
            big_streams.append(e)
    root.data = bytes(mini_stream)

    sectors: list[bytes] = []
    fat: list[int] = []

    def add_chain(data: bytes) -> int:
        if not data:
            return ENDOFCHAIN
        count = (len(data) + SECTOR - 1) // SECTOR
        first = len(sectors)
        for i in range(count):
            chunk = data[i * SECTOR:(i + 1) * SECTOR]
            sectors.append(chunk + b"\x00" * (SECTOR - len(chunk)))
            fat.append(first + i + 1 if i < count - 1 else ENDOFCHAIN)
        return first

    root.start = add_chain(root.data) if root.data else ENDOFCHAIN
    root.size = len(root.data)
    for e in big_streams:
        e.start = add_chain(e.data)
    # mini FAT sectors
    mini_fat_bytes = b"".join(struct.pack("<I", v) for v in mini_fat)
    mini_fat_start = add_chain(mini_fat_bytes) if mini_fat else ENDOFCHAIN
    mini_fat_count = (len(mini_fat_bytes) + SECTOR - 1) // SECTOR
    # directory
    dir_bytes = bytearray()
    for e in all_entries:
        name16 = (e.name + "\x00").encode("utf-16-le")
        entry = bytearray(128)
        entry[0:len(name16)] = name16
        struct.pack_into("<H", entry, 64, len(name16))
        entry[66] = e.kind
        entry[67] = 1  # black
        struct.pack_into("<III", entry, 68, e.left, e.right, e.child)
        # clsid (16) zero, state bits 0, times 0
        start = e.start if (e.kind == 2 and e.size > 0) or e.kind == 5 else (ENDOFCHAIN if e.kind == 2 else 0)
        if e.kind == 1:
            start = 0
        struct.pack_into("<I", entry, 116, start)
        struct.pack_into("<Q", entry, 120, e.size if e.kind != 1 else 0)
        dir_bytes += entry
    while len(dir_bytes) % SECTOR:
        empty = bytearray(128)
        struct.pack_into("<III", empty, 68, NOSTREAM, NOSTREAM, NOSTREAM)
        dir_bytes += empty
    dir_start = add_chain(bytes(dir_bytes))
    # FAT sectors (they describe themselves too)
    n_fat = 1
    while True:
        total = len(sectors) + n_fat
        if (total + 127) // 128 <= n_fat:
            break
        n_fat += 1
    fat_start = len(sectors)
    for _ in range(n_fat):
        fat.append(FATSECT)
    while len(fat) < n_fat * 128:
        fat.append(FREESECT)
    fat_bytes = b"".join(struct.pack("<I", v) for v in fat)
    for i in range(n_fat):
        sectors.append(fat_bytes[i * SECTOR:(i + 1) * SECTOR])
    if n_fat > 109:
        raise ValueError("project too large for this writer")

    header = bytearray(512)
    header[0:8] = bytes.fromhex("D0CF11E0A1B11AE1")
    struct.pack_into("<HHHHH", header, 24, 0x003E, 0x0003, 0xFFFE, 9, 6)
    struct.pack_into("<I", header, 40, 0)  # dir sectors (v3: 0)
    struct.pack_into("<I", header, 44, n_fat)
    struct.pack_into("<I", header, 48, dir_start)
    struct.pack_into("<I", header, 52, 0)  # transaction
    struct.pack_into("<I", header, 56, CUTOFF)
    struct.pack_into("<I", header, 60, mini_fat_start)
    struct.pack_into("<I", header, 64, mini_fat_count)
    struct.pack_into("<I", header, 68, ENDOFCHAIN)  # DIFAT start
    struct.pack_into("<I", header, 72, 0)
    for i in range(109):
        struct.pack_into("<I", header, 76 + 4 * i, fat_start + i if i < n_fat else FREESECT)
    return bytes(header) + b"".join(sectors)


# ---------------------------------------------------------------------------


def _norm_source(source: str) -> bytes:
    text = source.replace("\r\n", "\n").replace("\r", "\n")
    if not text.endswith("\n"):
        text += "\n"
    return text.replace("\n", "\r\n").encode("cp1252")


def document_module(name: str, workbook: bool) -> str:
    base = "0{00020819-0000-0000-C000-000000000046}" if workbook else "0{00020820-0000-0000-C000-000000000046}"
    return "\n".join([
        f'Attribute VB_Name = "{name}"',
        f'Attribute VB_Base = "{base}"',
        "Attribute VB_GlobalNameSpace = False",
        "Attribute VB_Creatable = False",
        "Attribute VB_PredeclaredId = True",
        "Attribute VB_Exposed = True",
        "Attribute VB_TemplateDerived = False",
        "Attribute VB_Customizable = True",
        "",
    ])


def build_vba_project(modules: list[tuple[str, str, bool]], seed: int = 7) -> bytes:
    """modules: (name, source text, is_document). Deterministic for a seed."""
    rng = random.Random(seed)
    project_id = "{" + str(uuid.UUID(int=rng.getrandbits(128))).upper() + "}"
    vba_children = [
        _Entry("dir", 2, compress(_dir_stream(modules))),
        _Entry("_VBA_PROJECT", 2, bytes([0xCC, 0x61, 0xFF, 0xFF, 0x00, 0x00, 0x00])),
    ]
    for name, source, _doc in modules:
        vba_children.append(_Entry(name, 2, compress(_norm_source(source))))
    vba = _Entry("VBA", 1)
    vba.children = vba_children
    project = _Entry("PROJECT", 2, _project_stream(project_id, modules, rng))
    project_wm = _Entry("PROJECTwm", 2, _project_wm(modules))
    return write_cfb([vba, project, project_wm])


if __name__ == "__main__":
    sample = b"Attribute VB_Name = \"X\"\r\n" * 300 + bytes(range(32, 127)) * 20
    assert decompress(compress(sample)) == sample
    pid = "{12345678-1234-1234-1234-123456789ABC}"
    for s in range(256):
        assert _decrypt(pid, _encrypt(pid, b"\x00\x00\x00\x00", s)) == b"\x00\x00\x00\x00"
    print("self-test ok")
