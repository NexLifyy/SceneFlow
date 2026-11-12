using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

class FolderPicker {
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [STAThread]
    static void Main(string[] args) {
        IntPtr fg = GetForegroundWindow();

        try {
            var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
            uint options;
            dialog.GetOptions(out options);
            // FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40
            dialog.SetOptions(options | 0x00000020 | 0x00000040);
            dialog.SetTitle("Select Destination Folder");

            int hr = dialog.Show(fg);
            if (hr == 0) {
                IShellItem item;
                dialog.GetResult(out item);
                string path;
                item.GetDisplayName(SIGDN.SIGDN_FILESYSPATH, out path);
                if (!string.IsNullOrEmpty(path)) {
                    Console.OutputEncoding = System.Text.Encoding.UTF8;
                    Console.Write(path);
                }
                return;
            } else if (hr == unchecked((int)0x800704C7)) {
                // User cancelled - exit cleanly
                return;
            }
        } catch {
            // Fall back to FolderBrowserDialog
        }

        try {
            using (var fbd = new FolderBrowserDialog()) {
                fbd.Description = "Select Destination Folder";
                fbd.ShowNewFolderButton = true;
                fbd.RootFolder = Environment.SpecialFolder.MyComputer;
                DialogResult res = fbd.ShowDialog();
                if (res == DialogResult.OK && !string.IsNullOrEmpty(fbd.SelectedPath)) {
                    Console.OutputEncoding = System.Text.Encoding.UTF8;
                    Console.Write(fbd.SelectedPath);
                }
            }
        } catch {
        }
    }

    [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileOpenDialog {
        [PreserveSig] int Show([In] IntPtr parent);
        void SetFileTypes();
        void SetFileTypeIndex();
        void GetFileTypeIndex();
        void Advise();
        void Unadvise();
        void SetOptions([In] uint fos);
        void GetOptions([Out] out uint fos);
        void SetDefaultFolder();
        void SetFolder();
        void GetFolder();
        void GetCurrentSelection();
        void SetFileName();
        void GetFileName();
        void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel();
        void SetFileNameLabel();
        void GetResult([Out] out IShellItem ppsi);
        void AddPlace();
        void SetDefaultExtension();
        void Close();
        void SetClientGuid();
        void ClearClientData();
        void SetFilter();
        void GetResults();
        void GetSelectedItems();
    }

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    class FileOpenDialogRCW { }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        void BindToHandler();
        void GetParent();
        void GetDisplayName([In] SIGDN sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes();
        void Compare();
    }

    enum SIGDN : uint { SIGDN_FILESYSPATH = 0x80058000 }
}
