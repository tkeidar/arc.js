import * as helpers from './helpers';
import { getValueFromLogs, requireContract } from '../lib/utils.js';

const DAOToken = requireContract("DAOToken");
const SimpleContributionScheme = requireContract("SimpleContributionScheme");

export async function proposeSimpleContributionScheme(org, accounts) {
  const schemeRegistrar = await org.scheme("SchemeRegistrar");
  const simpleContributionScheme = await org.scheme('SimpleContributionScheme');

  const votingMachineHash = await org.votingMachine.getParametersHash(org.reputation.address, 50, true);
  await org.votingMachine.setParameters(org.reputation.address, 50, true);

  const votingMachineAddress = org.votingMachine.address;

  const schemeParametersHash = await simpleContributionScheme.setParams({
    orgNativeTokenFee: 0,
    schemeNativeTokenFee:  0,
    voteParametersHash: votingMachineHash,
    votingMachine: votingMachineAddress
  });

  const tx = await schemeRegistrar.proposeToAddModifyScheme({
    avatar: org.avatar.address,
    scheme: simpleContributionScheme.address,
    schemeName: "SimpleContributionScheme",
    schemeParametersHash: schemeParametersHash
  });

  const proposalId = getValueFromLogs(tx, '_proposalId');

  org.vote(proposalId, 1, {from: accounts[2]});

  return simpleContributionScheme;
}

contract('SimpleContribution scheme', (accounts) => {
  let params, paramsHash, tx, proposal;

  before(() => {
    helpers.etherForEveryone();
  });

  it("submit and accept a contribution - complete workflow", async () => {
    const organization = await helpers.forgeOrganization();
    const scheme = await proposeSimpleContributionScheme(organization, accounts);

    tx = await scheme.proposeContribution({
      avatar: organization.avatar.address,  // Avatar _avatar,
      description: 'A new contribution', // string _contributionDesciption,
      beneficiary: accounts[1], // address _beneficiary
      nativeTokenReward: 1,
    });

    const proposalId = getValueFromLogs(tx, '_proposalId');

    // now vote with a majority account and accept this contribution
    organization.vote(proposalId, 1, {from: accounts[2]});

    // TODO: check that the proposal is indeed accepted
  });

  it("submit and accept a contribution - complete workflow with payments [TODO]", async () => {
    // TODO: write a similar test as the previous one, but with all different forms of payment
  });

  it("submit and accept a contribution - using the ABI Contract", async () => {
    const founders = [
      {
        address: accounts[0],
        tokens: 30,
        reputation: 30,
      },
      {
        address: accounts[1],
        tokens: 70,
        reputation: 70,
      },
    ];

    const org = await helpers.forgeOrganization({founders});

    const avatar = org.avatar;
    const controller = org.controller;

    // we creaet a SimpleContributionScheme
    const tokenAddress = await controller.nativeToken();
    const votingMachine = org.votingMachine;

    // create a contribution Scheme
    const contributionScheme = (await SimpleContributionScheme.new(
      tokenAddress,
      0, // register with 0 fee
      accounts[0],
    ));

    // check if we have the fee to register the contribution
    const contributionSchemeRegisterFee = await contributionScheme.fee();
    // console.log('contributionSchemeRegisterFee: ' + contributionSchemeRegisterFee);
    // our fee is 0, so that's easy  (TODO: write a test with non-zero fees)
    assert.equal(contributionSchemeRegisterFee, 0);

    const votingMachineHash = await votingMachine.getParametersHash(org.reputation.address, 50, true);
    await votingMachine.setParameters(org.reputation.address, 50, true);
    const votingMachineAddress = votingMachine.address;

    // console.log(`******  votingMachineHash ${votingMachineHash} ******`);
    // console.log(`******  votingMachineAddress ${votingMachineAddress} ******`);

    const schemeParametersHash = await contributionScheme.getParametersHash(
      0,
      0,
      votingMachineHash,
      votingMachineAddress
    );

    await contributionScheme.setParameters(
      0,
      0,
      votingMachineHash,
      votingMachineAddress
    );

    const schemeRegistrar = await org.scheme("SchemeRegistrar");

    tx = await schemeRegistrar.proposeToAddModifyScheme({
      avatar: avatar.address,
      scheme: contributionScheme.address,
      schemeName: "SimpleContributionScheme",
      schemeParametersHash: schemeParametersHash
    });

    const proposalId = getValueFromLogs(tx, '_proposalId');

    // this will vote-and-execute
    tx = await votingMachine.vote(proposalId, 1, {from: accounts[1]});

    // now our scheme should be registered on the controller
    const schemeFromController = await controller.schemes(contributionScheme.address);
    // we expect to have only the first bit set (it is a registered scheme without nay particular permissions)
    assert.equal(schemeFromController[1], '0x00000001');

    // is the organization registered?
    const orgFromContributionScheme = await contributionScheme.organizations(avatar.address);
    // console.log('orgFromContributionScheme after registering');
    assert.equal(orgFromContributionScheme, true);
    // check the configuration for proposing new contributions

    paramsHash = await controller.getSchemeParameters(contributionScheme.address);
    // console.log(`****** paramsHash ${paramsHash} ******`);
    // params are: uint orgNativeTokenFee; bytes32 voteApproveParams; uint schemeNativeTokenFee;         BoolVoteInterface boolVote;
    params = await contributionScheme.parameters(paramsHash);
    // check if they are not trivial - the 4th item should be a valid boolVote address
    assert.notEqual(params[3], '0x0000000000000000000000000000000000000000');
    assert.equal(params[3], votingMachine.address);
    // now we can propose a contribution
    tx = await contributionScheme.submitContribution(
      avatar.address, // Avatar _avatar,
      'a fair play', // string _contributionDesciption,
      0, // uint _nativeTokenReward,
      0, // uint _reputationReward,
      0, // uint _ethReward,
      '0x0008e8314d3f08fd072e06b6253d62ed526038a0', // StandardToken _externalToken, we provide some arbitrary address
      0, // uint _externalTokenReward,
      accounts[2], // address _beneficiary
    );

    // console.log(tx.logs);
    const contributionId = tx.logs[0].args._proposalId;
    // let us vote for it (is there a way to get the votingmachine from the contributionScheme?)
    // this is a minority vote for 'yes'
    // check preconditions for the vote
    proposal = await votingMachine.proposals(contributionId);
    // a propsoal has the following structure
    // 0. address owner;
    // 1. address avatar;
    // 2. Number Of Choices
    // 3. ExecutableInterface executable;
    // 4. bytes32 paramsHash;
    // 5. uint yes; // total 'yes' votes
    // 6. uint no; // total 'no' votes
    // MAPPING is skipped in the reutnr value...
    // X.mapping(address=>int) voted; // save the amount of reputation voted by an agent (positive sign is yes, negatice is no)
    // 7. bool opened; // voting opened flag
    assert.isOk(proposal[6]); // proposal.opened is true
    // first we check if our executable (proposal[3]) is indeed the contributionScheme
    assert.equal(proposal[3], contributionScheme.address);

    tx = await votingMachine.vote(contributionId, 1, {from: accounts[0]});
    // and this is the majority vote (which will also call execute on the executable
    tx = await votingMachine.vote(contributionId, 1, {from: accounts[1]});

    // TODO: check if proposal was deleted from contribution Scheme
    // proposal = await contributionScheme.proposals(contributionId);
    // assert.equal(proposal[0], helpers.NULL_HASH);

    // check if proposal was deleted from voting machine
    proposal = await votingMachine.proposals(contributionId);
    // TODO: proposal is not deleted from voting machine: is that feature or bug?
    // assert.notOk(proposal[6]); // proposal.opened is false

    // TODO: no payments have been made. Write another test for that.

  });

  it('Can set and get parameters', async () => {
    let params;

    const token = await DAOToken.new();

    // create a contribution Scheme
    const contributionScheme = await SimpleContributionScheme.new({
      tokenAddress: token.address,
      fee: 0, // register with 0 fee
      beneficiary: accounts[1],
    });

    const contributionSchemeParamsHash = await contributionScheme.getParametersHash(
      0,
      0,
      helpers.SOME_HASH,
      helpers.SOME_ADDRESS,
    );

      // these parameters are not registered yet at this point
    params = await contributionScheme.parameters(contributionSchemeParamsHash);
    assert.equal(params[3], '0x0000000000000000000000000000000000000000');

    // register the parameters are registers in the contribution scheme
    await contributionScheme.setParameters(
      0,
      0,
      helpers.SOME_HASH,
      helpers.SOME_ADDRESS,
    );

    params = await contributionScheme.parameters(contributionSchemeParamsHash);
    assert.notEqual(params[3], '0x0000000000000000000000000000000000000000');

  });


});
