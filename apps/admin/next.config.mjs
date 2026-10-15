export default process.env.STATIC_ADMIN_EXPORT === '1'
  ? {output:'export',basePath:'/admin',images:{unoptimized:true}}
  : {};
