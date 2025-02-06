import * as vscode from "vscode";
import * as vscodeHtmlService from "vscode-html-languageservice";
import path from "path";
import * as fs from "fs";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buttonsMap } from "../utils/buttonMap";

interface buttonInfoType {
    node: vscodeHtmlService.Node;
    label: string;
    vAllowValue: string;
    VAllowStatus: string;
}

let templateString: string = "";
let document: vscode.TextDocument;
let workspaceFolder: string = "";
let vAllowButtonMap: { [key: string]: string } = {};

const getActiveEditor = (): Promise<vscode.TextEditor> => {
    return new Promise((resolve) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage("没有活动的文本编辑器");
            return;
        }
        resolve(activeEditor);
    });
};

const getRelativePath = () => {
    const absolutePath = document.fileName;
    // 将绝对路径转换为相对路径
    const relativePath = path.relative(workspaceFolder, absolutePath);
    // 获取文件扩展名
    const ext = path.extname(relativePath);
    // 去除扩展名和’src/‘
    const relativePathWithoutExt = relativePath.slice(0, -ext.length);
    // 使用正则表达式去除路径开头的 src/
    const finalPath = relativePathWithoutExt.replace(/^src\//, "");
    return finalPath;
};

// 获取模版字符串生成的document
const getTextDocument = (): Promise<vscodeHtmlService.HTMLDocument> => {
    return new Promise((resolve) => {
        if (!vscodeHtmlService || !vscodeHtmlService.getLanguageService) {
            console.error("vscode-html-languageservice 模块导入或导出异常");
            return;
        }
        // 获取语言服务
        const languageService = vscodeHtmlService.getLanguageService();
        // 使用语言服务的 parseHTMLDocument 方法解析 HTML 文档
        const templateDocument = languageService.parseHTMLDocument({ getText: () => templateString } as TextDocument);
        resolve(templateDocument);
    });
};

// 获取项目内自定义v-allow-button.js对照表
const getVAllowButtonMap = async () => {
    // 定义要读取的文件路径
    const buttonMapPath = path.join(workspaceFolder, "falcon-magic.json");
    // 检查文件是否存在
    if (!fs.existsSync(buttonMapPath)) {
        return;
    }

    try {
        // 异步读取文件内容
        const data = await fs.promises.readFile(buttonMapPath, "utf8");
        vAllowButtonMap = JSON.parse(data).vAllowButtonMap || {};
    } catch (error) {
        console.log("error", error);
        vscode.window.showErrorMessage(`项目内未配置权限按钮对照: ${(error as Error).message}`);
    }
};

const getVAllowValue = (innerText: string) => {
    return vAllowButtonMap[innerText] || buttonsMap[innerText] || "";
};

// 获取到el-button的node和位置
const getButtonInfos = (templateDocument: vscodeHtmlService.HTMLDocument, relativePath: string) => {
    let hasUndefinedWord: number = 0;
    const buttonInfos: buttonInfoType[] = [];
    const traverseNodes = (nodes: vscodeHtmlService.Node[]) => {
        nodes.forEach((node) => {
            let innerText = "";
            if (typeof node.startTagEnd === "number" && typeof node.endTagStart === "number") {
                innerText += templateString.slice(node.startTagEnd, node.endTagStart).trim();
            }
            const vAllowValue = getVAllowValue(innerText);
            if (vAllowValue) {
                const buttonInfo = {
                    node,
                    label: innerText,
                    vAllowValue: `'${relativePath}:${vAllowValue}'`,
                };
                if (node.attributes) {
                    // 判断标签中是否有v-allow属性
                    if (node.attributes?.hasOwnProperty("v-allow")) {
                        const VAllow = node.attributes["v-allow"];
                        if (!VAllow) {
                            buttonInfos.push({ ...buttonInfo, VAllowStatus: "null" });
                        } else if (VAllow === '""') {
                            buttonInfos.push({ ...buttonInfo, VAllowStatus: "empty" });
                        } else {
                            //TODO
                            console.log("暂时搁置");
                        }
                    } else {
                        if (node.tag === "el-button") {
                            buttonInfos.push({ ...buttonInfo, VAllowStatus: "none" });
                        }
                    }
                }
            } else {
                hasUndefinedWord += 1;
            }
            if (node.children && node.children.length > 0) {
                traverseNodes(node.children);
            }
        });
    };

    traverseNodes(templateDocument.roots);

    if (hasUndefinedWord) {
        vscode.window.showInformationMessage("部分按钮请自行适配");
    }
    return buttonInfos;
};

const insertButtonPermission = (buttonInfos: buttonInfoType[]) => {
    let modifiedTemplateString = templateString;
    let offset = 0;

    // 处理 null 或 empty 状态的 v-allow 属性
    const handleNullOrEmpty = (VAllowStatus: string, start: number, newAttr: string) => {
        const startOfVAllowIndex = modifiedTemplateString.indexOf("v-allow", start);
        const handleModifiedTemplateString = (rightPartIndex: number) => {
            modifiedTemplateString =
                modifiedTemplateString.slice(0, startOfVAllowIndex) +
                newAttr +
                modifiedTemplateString.slice(rightPartIndex);
        };
        const handleOffset = (existingAttrLen: number) => {
            offset = offset - existingAttrLen + newAttr.length;
        };

        // 找到已有的 v-allow 属性并替换其值
        if (VAllowStatus === "empty") {
            // 标识为‘v-allow=""’
            const endOfVAllowIndex = modifiedTemplateString.indexOf('"', startOfVAllowIndex + 9);
            const existingAttr = modifiedTemplateString.slice(startOfVAllowIndex, endOfVAllowIndex + 1);
            handleModifiedTemplateString(endOfVAllowIndex + 1);
            handleOffset(existingAttr.length);
        } else {
            // 标识为‘v-allow’
            handleModifiedTemplateString(startOfVAllowIndex + 7);
            // v-allow长度为7
            handleOffset(7);
        }
    };

    // 处理 none 状态的 v-allow 属性
    const handleNone = (startTagEnd: number, newAttr: string) => {
        // 没有 v-allow 属性，添加新的
        modifiedTemplateString =
            modifiedTemplateString.slice(0, startTagEnd) + ` ${newAttr}` + modifiedTemplateString.slice(startTagEnd);
        offset += newAttr.length + 1;
    };

    buttonInfos.forEach((item) => {
        if (typeof item.node?.start === "number" && typeof item.node?.startTagEnd === "number") {
            const start = item.node.start + offset;
            const startTagEnd = item.node.startTagEnd + offset - 1;
            const newAttr = `v-allow="${item.vAllowValue}"`;
            if (["null", "empty"].includes(item.VAllowStatus)) {
                handleNullOrEmpty(item.VAllowStatus, start, newAttr);
            } else if (["none"].includes(item.VAllowStatus)) {
                handleNone(startTagEnd, newAttr);
            }
        }
    });
    return modifiedTemplateString;
};

/**
 *  自动修改所有的el-button，属性中1.不存在'v-allow'; 2.仅存在'v-allow'||'v-allow=""'
 *
 */
export default async function autoAddButtonPermission() {
    // 1. 获取当前激活的文本编辑器
    const activeEditor = await getActiveEditor();
    vscode.window.showInformationMessage("生成中");
    // 2. 获取当前编辑器的文档对象
    document = activeEditor.document;
    // 3. 获取文档的全部文本内容,模版字符串string
    templateString = document.getText();
    // 4.获取工作区的根目录
    workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath || "";
    // 5. 获取文件的相对路径
    const relativePath = getRelativePath();
    // 6. 获取模版字符串生成的HTMLDocument
    const templateDocument = await getTextDocument();
    // 7.获取项目内自定义v-allow-button.js对照表
    await getVAllowButtonMap();
    // 8. 获取到需要自动修改的el-button的node、位置、生成v-allow的值
    const buttonInfos = getButtonInfos(templateDocument, relativePath);
    // 9. 所有已有对应的按钮插入标识
    const modifiedTemplateString = insertButtonPermission(buttonInfos);
    // 10. 替换整个文档的内容
    activeEditor.edit((editBuilder) => {
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(templateString.length));
        editBuilder.replace(fullRange, modifiedTemplateString);
    });
}
