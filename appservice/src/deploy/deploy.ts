/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServicePlan, SiteConfigResource } from 'azure-arm-website/lib/models';
import * as opn from 'opn';
import { MessageItem, ProgressLocation, window } from 'vscode';
import { TelemetryProperties } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { localize } from '../localize';
import { ScmType } from '../ScmType';
import { SiteClient } from '../SiteClient';
import { randomUtils } from '../utils/randomUtils';
import { deployWar } from './deployWar';
import { deployZip } from './deployZip';
import { localGitDeploy } from './localGitDeploy';

export async function deploy(client: SiteClient, fsPath: string, configurationSectionName: string, telemetryProperties?: TelemetryProperties): Promise<void> {
    const config: SiteConfigResource = await client.getSiteConfig();
    if (telemetryProperties) {
        try {
            telemetryProperties.sourceHash = randomUtils.getPseudononymousStringHash(fsPath);
            telemetryProperties.destHash = randomUtils.getPseudononymousStringHash(client.fullName);
            telemetryProperties.scmType = config.scmType;
            telemetryProperties.isSlot = client.isSlot ? 'true' : 'false';
            telemetryProperties.alwaysOn = config.alwaysOn ? 'true' : 'false';
            telemetryProperties.linuxFxVersion = config.linuxFxVersion;
            telemetryProperties.nodeVersion = config.nodeVersion;
            telemetryProperties.pythonVersion = config.pythonVersion;
            telemetryProperties.hasCors = config.cors ? 'true' : 'false';
            telemetryProperties.hasIpSecurityRestrictions = config.ipSecurityRestrictions && config.ipSecurityRestrictions.length > 0 ? 'true' : 'false';
            telemetryProperties.javaVersion = config.javaVersion;
            client.getState().then(
                (state: string) => {
                    telemetryProperties.state = state;
                },
                () => {
                    // ignore
                });
            client.getAppServicePlan().then(
                (plan: AppServicePlan) => {
                    telemetryProperties.planStatus = plan.status;
                    telemetryProperties.planKind = plan.kind;
                    if (plan.sku) {
                        telemetryProperties.planSize = plan.sku.size;
                    }
                },
                () => {
                    // ignore
                });
        } catch (error) {
            // Ignore
        }
    }
    await window.withProgress({ location: ProgressLocation.Notification, title: localize('deploying', 'Deploying to "{0}"... Check output window for status.', client.fullName) }, async (): Promise<void> => {
        switch (config.scmType) {
            case ScmType.LocalGit:
                await localGitDeploy(client, fsPath);
                break;
            case ScmType.GitHub:
                throw new Error(localize('gitHubConnected', '"{0}" is connected to a GitHub repository. Push to GitHub repository to deploy.', client.fullName));
            default: //'None' or any other non-supported scmType
                if (config.linuxFxVersion && config.linuxFxVersion.toLowerCase().startsWith('tomcat')) {
                    await deployWar(client, fsPath);
                    break;
                }
                await deployZip(client, fsPath, configurationSectionName);
                break;
        }

        const deployComplete: string = !client.isFunctionApp ?
            localize('deployCompleteWithUrl', 'Deployment to "{0}" completed: {1}', client.fullName, client.defaultHostUrl) :
            localize('deployComplete', 'Deployment to "{0}" completed.', client.fullName);
        ext.outputChannel.appendLine(deployComplete);
        ext.outputChannel.appendLine('');
        const viewLogs: MessageItem = {
            title: localize('viewLogs', 'View Logs')
        };
        const browseWebsite: MessageItem = {
            title: localize('browseWebsite', 'Browse Website')
        };

        const buttons: MessageItem[] = [viewLogs];
        if (!client.isFunctionApp) {
            buttons.push(browseWebsite);
        }

        // Note: intentionally not waiting for the result of this before returning
        window.showInformationMessage(deployComplete, ...buttons).then(async (result: MessageItem | undefined) => {
            if (result === viewLogs) {
                ext.outputChannel.show();
            } else if (result === browseWebsite) {
                // tslint:disable-next-line:no-unsafe-any
                opn(client.defaultHostUrl);
            }
        });
    });
}
