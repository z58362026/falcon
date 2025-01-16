import * as vscode from "vscode";
export const getCurrentFileContent = (): string => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return "";
    }
    return activeEditor.document.getText();
};

export default async function autoAddButtonPermission() {
    // 1. 获取内容
    const content = getCurrentFileContent();
    console.log(content, "11111111");
}
