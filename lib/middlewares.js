'use strict'

const qs     = require('qs');
const _      = require('lodash');
const parse  = require('co-body');
const debug  = require('debug')('roas-restql:middlewares');

const common = require('./common');

const switchByType = common.switchByType;

function _getIndexes (model) {

  const {
    primaryKeys, options: { indexes, uniqueKeys }
  } = model;

  const idxes = [];

  if (primaryKeys) {
    const keys = Object.keys(primaryKeys);
    if (keys.length) {
      idxes.push({
        name    : 'PRIMARY',
        unique  : true,
        primary : true,
        fields  : keys
      })
    }
  }

  indexes.forEach(index => {
    idxes.push({
      unique : index.unique,
      name   : index.name,
      fields : index.fields
    })
  });

  Object.keys(uniqueKeys).forEach(key => {
    let uniqueKey = uniqueKeys[key]
    idxes.push({
      unique : true,
      name   : uniqueKey.name,
      fields : uniqueKey.fields
    })
  });

  return idxes;

}

function _getUniqueIndexes (model) {
  
  return _getIndexes(model).filter(index => index.unique);

}

function _getInstanceValidIndexes (indexes, data) {

  if (!data)
    return [];

  return indexes.filter(index => 
    index.fields.every(field => data[field] !== undefined));

}

function _getInstanceValidIndexFields (indexes, data) {

  if (!data || !indexes)
    return;
 
  const validIndexes = _getInstanceValidIndexes(indexes, data);

  if (!validIndexes.length) 
    return;

  const index = validIndexes[0];

  const fields = {};
  index.fields.forEach(field => {
    fields[field] = data[field]
  });

  return fields;

}

async function _upsert (ctx,model, data) {

  const uniqueIndexes = _getUniqueIndexes(model);

  const where = _getInstanceValidIndexFields(uniqueIndexes, data);

  if (!where) {
    ctx.throw('RestQL: unique index fields cannot be found', 400);
  }

  let created;

  try {

    created = 
      await model.upsert(data);

  } catch (error) {

    if (error.name !== 'SequelizeUniqueConstraintError') {
      throw new Error(error);
    }
    
    const message = `RestQL: ${model.name} unique constraint error`;
    ctx.throw(message, 409);

  }

  data = 
    await model.find({ 
      where,
    });

  if (!data) {
    data = 
      await model.find({ 
        where,
        paranoid: false
      });
  }

  if (isDeleted(model, data)) {
    await data.restore();
  }

  return { created, data };

}

async function _bulkUpsert (ctx, model, data)  {

  if (!data.length)
    return [];

  /**
   * updateOnDuplicate fields should be consistent
   */
  let isValid = true;
    
  if (data.length) {
    let match = JSON.stringify(Object.keys(data[0]).sort());
    isValid = data.map(row => 
      JSON.stringify(Object.keys(row).sort())).every(item => item === match);
  }

  if (!isValid) {
    ctx.throw('RestQL: array elements have different attributes', 400);
  }

  const $or = [];
  const uniqueIndexes = _getUniqueIndexes(model);

  data.forEach(row => {

    const where = _getInstanceValidIndexFields(uniqueIndexes, row);

    if (!where) {
      ctx.throw('RestQL: unique index fields cannot be found', 400);
    }

    $or.push(where);
  })

  /**
   * ignoreDuplicates only work in mysql
   */

  try {

    let updatedFields = Object.keys(data[0]).filter(key => 
      ['id'].indexOf(key) === -1);

    await model.bulkCreate(data, {
      updateOnDuplicate: updatedFields
    });

  } catch (error) {

    if (error.name !== 'SequelizeUniqueConstraintError') {
      throw new Error(error);
    }
    
    const message = `RestQL: ${model.name} unique constraint error`;
    ctx.throw(message, 409);

  }

  data = 
    await model.findAll({
      where: { $or },
      order: [['id', 'ASC']]
    });

  return data;

}

function _getUniqueConstraintErrorFields (model, error) {

  const attributes  = model.attributes;
  const fields      = error.fields;

  if (!fields)
    return;

  let fieldsIsValid = Object.keys(fields).every(key => attributes[key]);

  if (fieldsIsValid) 
    return fields;

  const uniqueIndexes = _getUniqueIndexes(model);
  const uniqueIndex   = uniqueIndexes.find(index => fields[index.name]);

  if (uniqueIndex && Array.isArray(uniqueIndex.fields)) {
    let value = fields[uniqueIndex.name];

    value = common.switchByType(value, {
      'number' : value => [ value ],
      'string' : value => value.split('-')
    });

    if (!value || !value.length)
      return;

    const ret = {};
    uniqueIndex.fields.forEach((field, index) => {
      ret[field] = value[index]
    });

    return ret;
  }
}

function isDeleted (model, row) {

  const attributes   = model.attributes;
  const paranoid     = model.options.paranoid;
  const deletedAtCol = model.options.deletedAt;

  if (!paranoid || !deletedAtCol) {
    return false;
  }

  if (!row) {
    return true;
  }

  let defaultDeletedAt = attributes[deletedAtCol].defaultValue;
  if (defaultDeletedAt === undefined) {
    defaultDeletedAt = null;
  }

  const deletedAt = row[deletedAtCol];

  if (defaultDeletedAt instanceof Date && deletedAt instanceof Date) {
    return defaultDeletedAt.getTime() !== deletedAt.getTime();
  } else {
    return defaultDeletedAt !== deletedAt;
  }

}

function setDefaultDeletedValue (model, data) {

  const attributes   = model.attributes;
  const paranoid     = model.options.paranoid;
  const deletedAtCol = model.options.deletedAt;

  if (!paranoid || !deletedAtCol) {
    return;
  }

  if (!data) {
    return;
  }

  let defaultDeletedAt = attributes[deletedAtCol].defaultValue;
  if (defaultDeletedAt === undefined) {
    defaultDeletedAt = null;
  }

  switchByType(data, {
    object : (data) => data[deletedAtCol] = defaultDeletedAt,
    array  : (data) => data.forEach(row => row[deletedAtCol] = defaultDeletedAt)
  });

}

async function _handleUniqueConstraintError (ctx,model, error, options) {

  options = options || {};

  const message = `RestQL: ${model.name} unique constraint error`;
  const status  = 409;

  const fields           = _getUniqueConstraintErrorFields(model, error);
  const attributes       = model.attributes;
  const paranoid         = model.options.paranoid;
  const deletedAtCol     = model.options.deletedAt;
  const ignoreDuplicates = options.ignoreDuplicates;

  if (!deletedAtCol || !paranoid) ;
    ctx.throw(message, status);

  let row = 
    await model.find({
      paranoid: false,
      where: fields
    });

  if (!fields || !row) {
    ctx.throw(message, status);
  }

  if (!ignoreDuplicates && !isDeleted(model, row)) {
    ctx.throw(message, status);
  }

  for (let key in attributes) {
    let defaultValue = attributes[key].defaultValue
    if (defaultValue !== undefined) {
      row.setDataValue(key, defaultValue);
    }
  }

  return { row, fields };

}

async function _create (ctx, model, data, options) {

  const id = data.id;

  try {

    if (id) {
      delete data.id;
    }

    data = 
      await model.create(data, options);

    return data;

  } catch (error) {

    if (error.name !== 'SequelizeUniqueConstraintError') {
      throw new Error(error);
    }

    const conflict = 
      await _handleUniqueConstraintError.call(this, ctx, model, error, options);

    const { 
      row, fields 
    } = conflict;

    data = 
      await _update.call(this, ctx, model, 
        _.assign({}, row.dataValues, data), { where: fields });

    data = data[0];

    return data;

  }

}

async function _bulkCreate (ctx, model, data, options)  {

  const $or           = [];
  const conflicts     = [];
  const uniqueIndexes = _getUniqueIndexes(model);

  data = data.slice();

  data.forEach(row => {

    const where = _getInstanceValidIndexFields(uniqueIndexes, row);

    if (!where) {
      this.throw('RestQL: unique index fields cannot be found', 400);
    }

    $or.push(where);
  })

  while (true) {

    try {

      await model.bulkCreate(data, options);
      break;

    } catch (error) {

      if (error.name !== 'SequelizeUniqueConstraintError') {
        throw new Error(error);
      }

      const conflict = 
        await _handleUniqueConstraintError.call(this, ctx, model, error);

      const {
        row, fields
      } = conflict;

      const index = data.findIndex(row => 
        Object.keys(fields).every(key => fields[key] == row[key]));

      if (index !== -1) {
        conflict.row = _.assign({}, row.dataValues, data[index]);
        conflicts.push(conflict);
        data.splice(index, 1);
      } else {
        ctx.throw('RestQL: bulkCreate unique index field error', 500);
      } 

    }

  }

  if (conflicts.length) {
    const rows = conflicts.map(conflicts => conflicts.row);

    try {

      await model.bulkCreate(rows, {
        updateOnDuplicate: Object.keys(model.attributes)
      });

    } catch (error) {

      if (error.name !== 'SequelizeUniqueConstraintError') {
        throw new Error(error);
      }

      const message = `RestQL: ${model.name} unique constraint error`;
      ctx.throw(message, 409);

    }
  }

  data = 
    await model.findAll({
      where: { $or },
      order: [['id', 'ASC']]
    });

  return data;

}

async function _update (ctx,model, data, options) {

  try {

    if (data.id) {
      delete data.id;
    }

    console.log(data);

    data = 
      await model.update(data, options);

    data =
      await model.findAll(options);

    return data;

  } catch (error) {

    if (error.name !== 'SequelizeUniqueConstraintError') {
      throw new Error(error);
    }

    const conflict = 
      await _handleUniqueConstraintError.call(this, ctx, model, error);

    const { row } = conflict;

    /**
     * @FIXME
     * restql should delete the conflict with paranoid = false 
     * and update again, now return 409 directly 
     * for conflict happens rarely
     */
    const message = `RestQL: ${model.name} unique constraint error`;
    ctx.throw(message, 409);

  }

}

async function _findExistingRows (model, data) {

  const $or = [];
  const uniqueIndexes = _getUniqueIndexes(model);

  function getOr (uniqueIndexes, data) {
    
    let fields = _getInstanceValidIndexFields(uniqueIndexes, data)
      , row    = data;

    return  { fields, row };
    
  }

  common.switchByType(data, {
    object : (data) => $or.push(getOr(uniqueIndexes, data)),
    array  : (data) => data.forEach(row => $or.push(getOr(uniqueIndexes, row)))
  });

  data = 
    await model.findAll({
      where: { $or : $or.map(or => or.fields) }
    });

  let existingRows  = [];
  let newRows       = [];

  if (data.length === $or.length) {

    existingRows = data;

  } else {

    /*
     * find existing rows
     */
    $or.forEach(or => {

      let index = data.findIndex(row => 
        Object.keys(or.fields).every(key => row[key] === or.row[key]));

      if (index !== -1) {
        existingRows.push(data[index]);
        data.splice(index, 1);
      } else {
        newRows.push(or.row);
      }

    }) 

  }

  return { existingRows, newRows };

}

function before () {
  let options = options || {};

  const defaults = {
    origin: true,
    methods: 'GET,HEAD,PUT,POST,DELETE'
  };

  // Set defaults
  for (let key in defaults) {
    if (!options.hasOwnProperty(key)) {
      options[key] = defaults[key];
    }
  }

  // Set expose
  if (Array.isArray(options.expose)) {
    options.expose = options.expose.join(',');
  }

  // Set maxAge
  if (typeof options.maxAge === 'number') {
    options.maxAge = options.maxAge.toString();
  } else {
    options.maxAge = null;
  }

  // Set methods
  if (Array.isArray(options.methods)) {
    options.methods = options.methods.join(',');
  }

  // Set headers
  if (Array.isArray(options.headers)) {
    options.headers = options.headers.join(',');
  }

  return async function (ctx,next) {

    debug(`RestQL: ${ctx.request.method} ${ctx.url}`);

    ctx.restql          = ctx.restql || {};
    ctx.restql.params   = ctx.restql.params   || {};
    ctx.restql.request  = ctx.restql.request  || {};
    ctx.restql.response = ctx.restql.response || {};

     /**
     * Access Control Allow Origin
     */
    let origin;

    if (typeof options.origin === 'string') {
      origin = options.origin;
    } else if (options.origin === true) {
      origin = ctx.get('origin') || '*';
    } else if (options.origin === false) {
      origin = options.origin;
    } else if (typeof options.origin === 'function') {
      origin = options.origin(ctx.request);
    }

    if (origin === false) return;

    ctx.set('Access-Control-Allow-Origin', origin);

    /**
     * Access Control Expose Headers
     */
    if (options.expose) {
      ctx.set('Access-Control-Expose-Headers', options.expose);
    }

    /**
     * Access Control Max Age
     */
    if (options.maxAge) {
      ctx.set('Access-Control-Max-Age', options.maxAge);
    }

    /**
     * Access Control Allow Credentials
     */
    if (options.credentials === true) {
      ctx.set('Access-Control-Allow-Credentials', 'true');
    }

    /**
     * Access Control Allow Methods
     */
    ctx.set('Access-Control-Allow-Methods', options.methods);

    /**
     * Access Control Allow Headers
     */
    let headers;

    if (options.headers) {
      headers = options.headers;
    } else {
      headers = ctx.get('access-control-request-headers');
    }

    if (headers) {
      ctx.set('Access-Control-Allow-Headers', headers);
    }

    await next();

  }
}

function after () {
  return async function (ctx,next) {

    const {
      response
    } = ctx.restql

    ctx.response.status = response.status || 200;
    ctx.response.body   = response.body;

    const headers = response.headers || {};

    for (let key in headers) {
      ctx.response.set(key, response.headers[key]);
    }

    debug(`RestQL: Succeed and Goodbye`);

    await next();

  }
}

function parseQuery (model, options) {
  return async function (ctx,next) {

    const {
      method, querystring
    } = ctx.request;

    const query = ctx.restql.query || qs.parse(querystring, options.qs || {});

    ctx.restql.query = 
      common.parseQuery(query, model, method.toLowerCase(), options);

    await next();

  }
}

function findById (model, query) {
  return async function (ctx,next) {

    query = query || {};

    const id = ctx.params.id;

    if (!id) {
      return await next();
    } 

    const data = 
      await model.findById(id, query);

    if (!data) {
      ctx.throw(`RestQL: ${model.name} ${id} cannot be found`, 404);
    }

    ctx.restql.params.data   = data;
    ctx.restql.response.body = data;

    await next();

  }
}

function pagination (model) {
  return async function (ctx,next) {

    const {
      response, params, query
    } = ctx.restql;

    const {
      count, rows
    } = response.body;

    const {
      offset, limit
    } = query;

    let status = 200;

    const _count = switchByType(count, {
      'number' : (value) => value,
      'array'  : (value) => value.length
    });

    const xRangeHeader = `objects ${offset}-${offset + rows.length}/${_count}`;

    if (_count > limit)
      status = 206;

    response.headers = response.headers || {};
    response.headers['X-Range'] = xRangeHeader;
    response.body   = rows;
    response.status = status;

    await next();

  }
}

function upsert (model) {
  return async function (ctx,next) {

    const {
      request, response
    } = ctx.restql;

    const {
      body
    } = request;

    let status = 200;

    if (Array.isArray(body)) {
      return await next();
    } 

    setDefaultDeletedValue(model, body);
    const uniqueIndexes = _getUniqueIndexes(model);
    const where = _getInstanceValidIndexFields(uniqueIndexes, body);
    
    let data    = null
      , created = false;

    if (where) {

      const result  = 
        await _upsert.call(this, ctx, model, body);

      created = result.created;
      data    = result.data;

    } else {

      created = true;

      /// don't have include
      data = 
        await _create.call(this,ctx, model, body, {
          fields: Object.keys(model.attributes) 
        });

    }

    if (created)
      status = 201;

    response.body   = data;
    response.status = status;

   await next();

  }
}

function findOrUpsert (model) {
  return async function (ctx,next) {

    const {
      request, response
    } = ctx.restql;

    let status = 200;

    if (Array.isArray(request.body)) {
      return await next();
    } 

    const {
      existingRows, newRows
    } = await _findExistingRows.call(this, model, [ request.body ]);

    let data;

    if (newRows.length){
      status = 201;
      let ret = 
        await _upsert.call(this, ctx, model, newRows[0]);

      if (ret.created)
        status = 201;

      data = ret.data;
    } else {
      data = existingRows[0];
    }
    
    response.body   = data;
    response.status = status;

    await next();

  }
}


function bulkUpsert (model) {
  return async function (ctx,next) {

    const {
      request, response
    } = ctx.restql;
    
    const body   = request.body;
    const status = 200;

    if (!Array.isArray(body)) {
      return await next();
    }

    setDefaultDeletedValue(model, body);

    const data = 
      await _bulkUpsert.call(this,ctx, model, body);

    response.body   = data;
    response.status = status;

    await next();
    
  }
}

function bulkFindOrUpsert (model) {
  return async function (ctx,next) {

    const {
      request, response
    } = ctx.restql;

    const status = 200;

    if (!Array.isArray(request.body)) {
      return await next();
    }

    const {
      existingRows, newRows
    } = await _findExistingRows.call(this, model, request.body);

    let data = []

    if (newRows.length){
      data = 
        await _bulkUpsert.call(this, ctx, model, newRows);
    }    

    data.forEach(row => existingRows.push(row));

    response.body   = existingRows;
    response.status = status;

    await next();

  }
}

function create (model) {
  return async function (ctx,next) {

    const {
      request, response, query
    } = ctx.restql;

    const body   = request.body;
    const status = 201;

    if (Array.isArray(body)) {
      return await next();
    } 

    const include = [];
    const associations    = model.associations;
    const associationList = Object.keys(associations);

    for (let key in body) {
      
      let value = body[key];
      if ('object' === typeof value) {
        if (associationList.indexOf(key) !== -1) {
          include.push(associations[key]);
        }
      }

    }
    
    setDefaultDeletedValue(model, body);
    const data = 
      await _create.call(this, ctx, model, body, {
        ignoreDuplicates: query.ignoreDuplicates,
        include
      });

    response.body   = data;
    response.status = status;

    return await next();

  }
}

function bulkCreate (model) {
  return async function (ctx,next) {
    
    const {
      request, response
    } = ctx.restql;

    const body   = request.body;
    const status = 201;

    if (!Array.isArray(body)) {
      return await next();
    }

    setDefaultDeletedValue(model, body)
    const data = 
      await _bulkCreate.call(this, ctx, model, body);

    response.body   = data;
    response.status = status;

    await next();
  }
}

function parseRequestBody (allowedTypes) {
  return async function (ctx,next) {

    const body = ctx.request.body 
      || ctx.restql.request.body 
      || (await parse(ctx));

    ctx.restql.request.body = ctx.request.body = body;

    if (!allowedTypes) {
      return await next();
    } 

    const validators = {};
    allowedTypes.forEach(type => {
      validators[type] = true;
    })

    validators.defaults = () => {
      ctx.throw(`RestQL: ${allowedTypes.join()} body are supported`, 400);
    }

    common.switchByType(body, validators);

    await next();

  }
}

function destroy (model) {
  return async function (ctx,next) {
    
    const query  = ctx.restql.query || {};
    const where  = query.where || {};
    const status = 204;

    await model.destroy({
      where
    });

    ctx.restql.response.status = status;
    await next();

  }
}

module.exports.before           = before;
module.exports.after            = after;
module.exports.pagination       = pagination;
module.exports.parseRequestBody = parseRequestBody;
module.exports.parseQuery       = parseQuery;
module.exports.upsert           = upsert;
module.exports.bulkUpsert       = bulkUpsert;
module.exports.findOrUpsert     = findOrUpsert;
module.exports.bulkFindOrUpsert = bulkFindOrUpsert;
module.exports.create           = create;
module.exports.bulkCreate       = bulkCreate;
module.exports.destroy          = destroy;
module.exports.findById         = findById;
