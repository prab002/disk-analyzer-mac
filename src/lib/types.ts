// Mirror of the Rust `Node` struct sent over IPC.
export interface FileNode {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  file_count: number;
  children?: FileNode[];
}
