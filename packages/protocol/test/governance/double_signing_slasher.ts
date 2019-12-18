import { CeloContractName } from '@celo/protocol/lib/registry-utils'
import { assertRevert, NULL_ADDRESS } from '@celo/protocol/lib/test-utils'
import { toFixed } from '@celo/utils/lib/fixidity'
import { addressToPublicKey } from '@celo/utils/lib/signatureUtils'
import BigNumber from 'bignumber.js'
import {
  AccountsContract,
  AccountsInstance,
  MockElectionContract,
  MockElectionInstance,
  MockLockedGoldContract,
  MockLockedGoldInstance,
  RegistryContract,
  RegistryInstance,
  TestDoubleSigningSlasherContract,
  TestDoubleSigningSlasherInstance,
  ValidatorsTestContract,
  ValidatorsTestInstance,
} from 'types'

const Accounts: AccountsContract = artifacts.require('Accounts')
const Validators: ValidatorsTestContract = artifacts.require('ValidatorsTest')
const DoubleSigningSlasher: TestDoubleSigningSlasherContract = artifacts.require(
  'TestDoubleSigningSlasher'
)
const MockElection: MockElectionContract = artifacts.require('MockElection')
const MockLockedGold: MockLockedGoldContract = artifacts.require('MockLockedGold')
const Registry: RegistryContract = artifacts.require('Registry')

// @ts-ignore
// TODO(mcortesi): Use BN
Validators.numberFormat = 'BigNumber'
// @ts-ignore
DoubleSigningSlasher.numberFormat = 'BigNumber'

const HOUR = 60 * 60
const DAY = 24 * HOUR
// Hard coded in ganache.
const EPOCH = 100

contract('DoubleSigningSlasher', (accounts: string[]) => {
  let accountsInstance: AccountsInstance
  let validators: ValidatorsTestInstance
  let registry: RegistryInstance
  let mockElection: MockElectionInstance
  let mockLockedGold: MockLockedGoldInstance
  let slasher: TestDoubleSigningSlasherInstance

  const validatorLockedGoldRequirements = {
    value: new BigNumber(1000),
    duration: new BigNumber(60 * DAY),
  }
  const groupLockedGoldRequirements = {
    value: new BigNumber(1000),
    duration: new BigNumber(100 * DAY),
  }
  const validatorScoreParameters = {
    exponent: new BigNumber(5),
    adjustmentSpeed: toFixed(0.25),
  }
  const membershipHistoryLength = new BigNumber(5)
  const maxGroupSize = new BigNumber(5)

  // A random 64 byte hex string.
  const blsPublicKey =
    '0x4fa3f67fc913878b068d1fa1cdddc54913d3bf988dbe5a36a20fa888f20d4894c408a6773f3d7bde11154f2a3076b700d345a42fd25a0e5e83f4db5586ac7979ac2053cd95d8f2efd3e959571ceccaa743e02cf4be3f5d7aaddb0b06fc9aff00'
  const blsPoP =
    '0xcdb77255037eb68897cd487fdd85388cbda448f617f874449d4b11588b0b7ad8ddc20d9bb450b513bb35664ea3923900'
  const commission = toFixed(1 / 100)

  const registerValidator = async (address: string) => {
    await mockLockedGold.setAccountTotalLockedGold(address, validatorLockedGoldRequirements.value)
    const publicKey = await addressToPublicKey(address, web3.eth.sign)
    await validators.registerValidator(
      // @ts-ignore bytes type
      publicKey,
      // @ts-ignore bytes type
      blsPublicKey,
      // @ts-ignore bytes type
      blsPoP,
      { from: address }
    )
  }

  const registerValidatorGroup = async (group: string) => {
    await mockLockedGold.setAccountTotalLockedGold(group, groupLockedGoldRequirements.value)
    await validators.registerValidatorGroup(commission, { from: group })
  }

  const registerValidatorGroupWithMembers = async (group: string, members: string[]) => {
    await registerValidatorGroup(group)
    for (const address of members) {
      await registerValidator(address)
      await validators.affiliate(group, { from: address })
      if (address === members[0]) {
        await validators.addFirstMember(address, NULL_ADDRESS, NULL_ADDRESS, { from: group })
      } else {
        await validators.addMember(address, { from: group })
      }
    }
  }

  const nonOwner = accounts[1]
  const validator = accounts[1]

  beforeEach(async () => {
    accountsInstance = await Accounts.new()
    await Promise.all(accounts.map((account) => accountsInstance.createAccount({ from: account })))
    mockElection = await MockElection.new()
    mockLockedGold = await MockLockedGold.new()
    registry = await Registry.new()
    validators = await Validators.new()
    slasher = await DoubleSigningSlasher.new()
    await accountsInstance.initialize(registry.address)
    await registry.setAddressFor(CeloContractName.Accounts, accountsInstance.address)
    await registry.setAddressFor(CeloContractName.Election, mockElection.address)
    await registry.setAddressFor(CeloContractName.LockedGold, mockLockedGold.address)
    await registry.setAddressFor(CeloContractName.Validators, validators.address)
    await registry.setAddressFor(CeloContractName.DoubleSigningSlasher, slasher.address)
    await registry.setAddressFor(CeloContractName.DowntimeSlasher, accounts[5])
    await registry.setAddressFor(CeloContractName.GovernanceSlasher, accounts[6])
    await registry.setAddressFor(CeloContractName.Governance, accounts[7])
    await validators.initialize(
      registry.address,
      groupLockedGoldRequirements.value,
      groupLockedGoldRequirements.duration,
      validatorLockedGoldRequirements.value,
      validatorLockedGoldRequirements.duration,
      validatorScoreParameters.exponent,
      validatorScoreParameters.adjustmentSpeed,
      membershipHistoryLength,
      maxGroupSize
    )
    const group = accounts[0]
    await registerValidatorGroupWithMembers(group, [validator])
    await registerValidatorGroupWithMembers(accounts[3], [accounts[4]])
    await slasher.initialize(registry.address, 10000, 100)
    await mockLockedGold.incrementNonvotingAccountBalance(validator, 50000)
    await mockLockedGold.incrementNonvotingAccountBalance(group, 50000)
  })

  describe('#initialize()', () => {
    it('should have set the owner', async () => {
      const owner: string = await slasher.owner()
      assert.equal(owner, accounts[0])
    })
    it('should have set slashing incentives', async () => {
      const res = await slasher.slashingIncentives()
      assert.equal(res[0].toNumber(), 10000)
      assert.equal(res[1].toNumber(), 100)
    })
  })

  describe('#setSlashingIncentives()', () => {
    it('can only be set by the owner', async () => {
      await assertRevert(slasher.setSlashingIncentives(123, 67, { from: nonOwner }))
    })
    it('should have set slashing incentives', async () => {
      await slasher.setSlashingIncentives(123, 67)
      const res = await slasher.slashingIncentives()
      assert.equal(res[0].toNumber(), 123)
      assert.equal(res[1].toNumber(), 67)
    })
  })

  describe('#slash()', () => {
    const blockNumber = 100
    const validatorIndex = 5
    const blockA = ['0x12', '0x12', '0x12']
    const blockB = ['0x13', '0x13', '0x13']
    const blockC = ['0x11', '0x13', '0x14']
    beforeEach(async () => {
      await slasher.setBlockNumber(blockA, blockNumber)
      await slasher.setBlockNumber(blockB, blockNumber + 1)
      await slasher.setBlockNumber(blockC, blockNumber)
      await slasher.setEpochSigner(Math.floor(blockNumber / EPOCH), validatorIndex, validator)
      await slasher.setEpochSigner(Math.floor(blockNumber / EPOCH), validatorIndex + 1, validator)
      const bitmap = '0x000000000000000000000000000000000000000000000000000000000000003f'
      await slasher.setNumberValidators(7)
      await slasher.setVerifiedSealBitmap(blockA, bitmap)
      await slasher.setVerifiedSealBitmap(blockB, bitmap)
      await slasher.setVerifiedSealBitmap(blockC, bitmap)
    })
    it('fails if block numbers do not match', async () => {
      await assertRevert(
        slasher.slash(validator, validatorIndex, blockA, blockB, 0, [], [], [], [], [], [])
      )
    })
    it('fails if is not signed at index', async () => {
      await assertRevert(
        slasher.slash(validator, validatorIndex + 1, blockA, blockC, 0, [], [], [], [], [], [])
      )
    })
    it('fails if epoch signer is wrong', async () => {
      await assertRevert(
        slasher.slash(accounts[4], validatorIndex, blockA, blockC, 0, [], [], [], [], [], [])
      )
    })
    it('decrements gold when success', async () => {
      await slasher.slash(validator, validatorIndex, blockA, blockC, 0, [], [], [], [], [], [])
      const balance = await mockLockedGold.nonvotingAccountBalance(validator)
      assert.equal(balance.toNumber(), 40000)
    })
    it('fails when tried second time', async () => {
      await slasher.slash(validator, validatorIndex, blockA, blockC, 0, [], [], [], [], [], [])
      await assertRevert(
        slasher.slash(validator, validatorIndex, blockA, blockC, 0, [], [], [], [], [], [])
      )
    })
  })
})
