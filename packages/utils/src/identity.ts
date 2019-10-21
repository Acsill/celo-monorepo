import scrypt from 'scrypt-js'
import { isE164Number } from './phoneNumbers'

enum IdentifierTypeEnum {
  PHONE_NUMBER = 'phone_number',
}

enum IdentifierPrefixEnum {
  PHONE_NUMBER = 'tel://',
}

const SCRYPT_PARAMS = {
  salt: 'cel0',
  N: 512,
  r: 16,
  p: 1,
  dkLen: 32,
}

async function calculateHash(identifier: string) {
  return new Promise<string>((resolve, reject) => {
    scrypt(
      Buffer.from(identifier.normalize('NFKC')),
      Buffer.from(SCRYPT_PARAMS.salt.normalize('NFKC')),
      SCRYPT_PARAMS.N,
      SCRYPT_PARAMS.r,
      SCRYPT_PARAMS.p,
      SCRYPT_PARAMS.dkLen,
      (error: any, progress: any, key: any) => {
        if (error) {
          reject(`Unable to hash ${identifier}, error: ${error}`)
        } else if (key) {
          let hexHash = ''
          for (const item of key) {
            hexHash += item.toString(16)
          }
          // @ts-ignore
          hexHash = hexHash.padStart(64, '0')
          if (hexHash.startsWith('0x')) {
            resolve(hexHash)
          } else {
            resolve('0x' + hexHash)
          }
        } else if (progress) {
          // do nothing
        }
      }
    )
  })
}

function preprocessPrefix(identifier: string, type: IdentifierTypeEnum) {
  let identifierPrefix = ''
  switch (type) {
    // identifier is phone number
    case IdentifierTypeEnum.PHONE_NUMBER:
      if (!isE164Number(identifier)) {
        throw Error('Attempting to hash a non-e164 number: ' + identifier)
      }
      identifierPrefix = IdentifierPrefixEnum.PHONE_NUMBER
    default:
    // default: wont add prefix
  }
  return `${identifierPrefix}${identifier}`
}

function preprocessPrefixBulk(identifierList: string[], type: IdentifierTypeEnum) {
  let identifierPrefix = ''
  switch (type) {
    // identifier is phone number
    case IdentifierTypeEnum.PHONE_NUMBER:
      identifierPrefix = IdentifierPrefixEnum.PHONE_NUMBER
    default:
    // default: wont add prefix
  }
  return identifierList.map((identifier) => `${identifierPrefix}${identifier}`)
}

function identityHash(
  identifier: string,
  type: IdentifierTypeEnum = IdentifierTypeEnum.PHONE_NUMBER
): Promise<string> {
  if (!identifier) {
    throw Error('Attempting to hash an empty identifier')
  }
  const modifiedIdentifier = preprocessPrefix(identifier, type)
  return calculateHash(modifiedIdentifier)
}

export const IdentityUtils = {
  identityHash,
  IdentifierTypeEnum,
  preprocessPrefix,
  SCRYPT_PARAMS,
  preprocessPrefixBulk,
}
