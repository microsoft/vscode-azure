/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Makes the specified properties of `T` non-optional and removes
 * `undefined` from their type. All other properties are left unchanged.
 *
 * Useful for Azure SDK types that declare properties as optional
 * (`id?: string`) even though the REST API always returns them.
 *
 * @example
 * ```ts
 * import type { ResourceGroup as SdkResourceGroup } from '@azure/arm-resources';
 *
 * // SDK declares id, name, type as optional--they never are in practice
 * type ResourceGroup = WithRequired<SdkResourceGroup, 'id' | 'name' | 'type'>;
 * ```
 */
export type WithRequired<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
