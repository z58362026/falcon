import * as vscode from "vscode";
import * as vscodeHtmlService from "vscode-html-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buttonsMap } from "../utils/buttonMap";

interface buttonInfoType {
    node: vscodeHtmlService.Node;
    label: string;
    vAllowValue: string;
}
let languageService: vscodeHtmlService.LanguageService;
let templateString: string = "";

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

const getRelativePath = (document: vscode.TextDocument) => {
    const absolutePath = document.fileName;
    // 获取工作区的根目录
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    // 将绝对路径转换为相对路径
    const path = require("path");
    const relativePath = path.relative(workspaceFolder, absolutePath);
    return relativePath;
};

// 获取模版字符串生成的document
const getTextDocument = (): Promise<vscodeHtmlService.HTMLDocument> => {
    return new Promise((resolve) => {
        if (!vscodeHtmlService || !vscodeHtmlService.getLanguageService) {
            console.error("vscode-html-languageservice 模块导入或导出异常");
            return;
        }
        // 获取语言服务
        languageService = vscodeHtmlService.getLanguageService();
        // 使用语言服务的 parseHTMLDocument 方法解析 HTML 文档
        const document = languageService.parseHTMLDocument({ getText: () => templateString } as TextDocument);
        resolve(document);
    });
};

// 获取到el-button的node和位置
const getButtonInfos = (document: vscodeHtmlService.HTMLDocument, filePath: string) => {
    let hasUndefinedWord: number = 0;
    const buttonInfos: buttonInfoType[] = [];
    const traverseNodes = (nodes: vscodeHtmlService.Node[]) => {
        nodes.forEach((node) => {
            let innerText = "";
            if (typeof node.startTagEnd === "number" && typeof node.endTagStart === "number") {
                innerText += templateString.slice(node.startTagEnd, node.endTagStart).trim();
            }
            const vAllowValue = buttonsMap[innerText] || "";
            if (vAllowValue) {
                const buttonInfo = {
                    node,
                    label: innerText,
                    vAllowValue: `'${filePath}:${vAllowValue}'`,
                };
                if (node.attributes) {
                    // 判断标签中是否有v-allow属性
                    if (node.attributes?.hasOwnProperty("v-allow")) {
                        const VAllow = node.attributes["v-allow"];
                        if (!VAllow || VAllow === '""') {
                            buttonInfos.push(buttonInfo);
                        } else {
                            //TODO
                            console.log("暂时搁置");
                        }
                    } else {
                        if (node.tag === "el-button") {
                            buttonInfos.push(buttonInfo);
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

    traverseNodes(document.roots);

    if (hasUndefinedWord) {
        vscode.window.showInformationMessage("本文件存在按钮无法自动生成，请自行适配");
    }
    return buttonInfos;
};

const insertButtonPermission = (buttonInfos: buttonInfoType[]) => {
    let modifiedTemplateString = templateString;
    let offset = 0;

    buttonInfos.forEach((item) => {
        if (typeof item.node?.start === "number" && typeof item.node?.startTagEnd === "number") {
            const start = item.node.start + offset;
            const startTagEnd = item.node.startTagEnd + offset - 1;
            const newAttr = `v-allow="${item.vAllowValue}"`;
            const isExistingVAllow = modifiedTemplateString.slice(start, startTagEnd).includes("v-allow");
            if (isExistingVAllow) {
                // 找到已有的 v-allow 属性并替换其值
                const isExistWholeVAllow = modifiedTemplateString.slice(start, startTagEnd).includes('v-allow="');
                if (isExistWholeVAllow) {
                    // 标识为‘v-allow=""’
                    const startOfVAllowIndex = modifiedTemplateString.indexOf('v-allow="', start);
                    const endOfVAllowIndex = modifiedTemplateString.indexOf('"', startOfVAllowIndex + 9);
                    const existingAttr = modifiedTemplateString.slice(startOfVAllowIndex, endOfVAllowIndex + 1);
                    modifiedTemplateString =
                        modifiedTemplateString.slice(0, startOfVAllowIndex) +
                        newAttr +
                        modifiedTemplateString.slice(endOfVAllowIndex + 1);
                    offset = offset - existingAttr.length + newAttr.length;
                } else {
                    // 标识为‘v-allow’
                    const startOfVAllowIndex = modifiedTemplateString.indexOf("v-allow", start);
                    // v-allow长度为7
                    modifiedTemplateString =
                        modifiedTemplateString.slice(0, startOfVAllowIndex) +
                        newAttr +
                        modifiedTemplateString.slice(startOfVAllowIndex + 7);
                    offset = offset - 7 + newAttr.length;
                }
            } else {
                // 没有 v-allow 属性，添加新的
                modifiedTemplateString =
                    modifiedTemplateString.slice(0, startTagEnd) +
                    ` ${newAttr}` +
                    modifiedTemplateString.slice(startTagEnd);
                offset += newAttr.length + 1;
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
    // 2. 获取当前编辑器的文档对象
    const document = activeEditor.document;
    // 3. 获取文档的全部文本内容,模版字符串string
    templateString = document.getText();
    // 4. 获取文件的相对路径
    const relativePath = getRelativePath(document);
    vscode.window.showInformationMessage("生成中");
    // 5. 获取模版字符串生成的HTMLDocument
    const templateDocument = await getTextDocument();
    // 6. 获取到需要自动修改的el-button的node、位置、生成v-allow的值
    const elButtonInfos = getButtonInfos(templateDocument, relativePath);
    // 7. 所有已有对应的按钮插入标识
    const modifiedTemplateString = insertButtonPermission(elButtonInfos);
    // 8. 替换整个文档的内容
    activeEditor.edit((editBuilder) => {
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(templateString.length));
        editBuilder.replace(fullRange, modifiedTemplateString);
    });
}
